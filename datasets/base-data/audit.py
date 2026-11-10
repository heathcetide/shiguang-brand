"""Reproducible evidence inventory of the locked rc.7 archive; Python stdlib only.

This does not certify cooking safety or infer missing nutrition/permissions.
Run: python3 datasets/base-data/audit.py ARCHIVE.zip OUTPUT.zip
"""
import hashlib
import json
import math
from pathlib import Path
import sys
import unicodedata
import zipfile

ROOT = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode()


def verified_files(archive, lock, source_lock):
    if digest(Path(archive).read_bytes()) != lock["sha256"]:
        raise ValueError("Archive SHA-256 differs from archive.lock.json")
    if digest(source_lock) != lock["sources_lock_sha256"]:
        raise ValueError("Source lock was modified")
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive member")
        files = {name: z.read(name) for name in names}
    manifest = json.loads(files["manifest.json"])
    entries = manifest["files"]
    if len({entry["path"] for entry in entries}) != len(entries):
        raise ValueError("Duplicate manifest entry")
    if set(files) != {"manifest.json", *(entry["path"] for entry in entries)}:
        raise ValueError("Manifest coverage differs from archive members")
    for entry in entries:
        content = files[entry["path"]]
        if digest(content) != entry["sha256"] or len(content) != entry["bytes"]:
            raise ValueError("Member integrity failure: " + entry["path"])
    if files["sources.lock.json"] != source_lock:
        raise ValueError("Archive source lock differs from repository")
    return files


def positive(value):
    return (isinstance(value, (float, int)) and not isinstance(value, bool)
            and math.isfinite(value) and value > 0)


def normalize(name):
    return "".join(unicodedata.normalize("NFKC", name).casefold().split())


def audit(files):
    collections = {name: json.loads(files[f"clean/{name}.json"])
                   for name in ("ingredients", "kitchenware", "recipes")}
    expected = {"ingredients": 447, "kitchenware": 241, "recipes": 341}
    indexes = {}
    for name, rows in collections.items():
        indexes[name] = {row["id"]: row for row in rows}
        if len(rows) != expected[name] or len(indexes[name]) != len(rows):
            raise ValueError("Unexpected count or duplicate logical ID: " + name)
    results = {}
    for collection, rows in collections.items():
        names = {}
        for row in rows:
            name = row.get("title", row.get("name", ""))
            names.setdefault(normalize(name), []).append(row["id"])
        reviews = []
        for row in sorted(rows, key=lambda r: r["id"]):
            name = row.get("title", row.get("name", ""))
            gaps = []
            license_name = row.get("source_license")
            evidence = {
                "name": name,
                "possible_duplicates": sorted(i for i in names[normalize(name)] if i != row["id"]),
                "source_url": row.get("source_url") or None,
                "declared_license": license_name,
                "source_record_sha256": digest(encoded(row)),
            }
            if not name.strip():
                gaps.append("name_missing")
            if evidence["possible_duplicates"]:
                gaps.append("duplicate_relationship_needs_review")
            if not license_name:
                gaps.append("license_evidence_missing")
            if not evidence["source_url"]:
                gaps.append("source_url_missing")
            if collection == "recipes":
                ingredients = []
                for index, item in enumerate(row["ingredients"]):
                    target = indexes["ingredients"].get(item.get("ingredient_id"))
                    ingredients.append({"index": index, "name": item.get("name"),
                                        "logical_id": item.get("ingredient_id"),
                                        "target_name": target["name"] if target else None,
                                        "quantity": item.get("quantity"), "unit": item.get("unit"),
                                        "amount_text": item.get("amount_text")})
                    if target is None:
                        gaps.append(f"ingredient_{index}_mapping_missing")
                    elif normalize(item.get("name", "")) not in {
                        normalize(v) for v in [target["name"], *target.get("aliases", [])]
                    }:
                        gaps.append(f"ingredient_{index}_mapping_name_needs_review")
                    if not positive(item.get("quantity")) or not item.get("unit"):
                        gaps.append(f"ingredient_{index}_structured_amount_missing")
                if not ingredients:
                    gaps.append("ingredients_missing")
                if not positive(row.get("servings")):
                    gaps.append("servings_missing")
                if not row.get("steps"):
                    gaps.append("steps_missing")
                equipment = [{"logical_id": item, "name": indexes["kitchenware"].get(item, {}).get("name")}
                             for item in row.get("kitchenware_ids", [])]
                if not equipment or any(item["name"] is None for item in equipment):
                    gaps.append("kitchenware_mapping_missing")
                # rc.7 has no approved per-task, storage or substitution evidence.
                # Presence of prose/estimated_minutes is not verification.
                gaps.extend(["cooking_execution_not_verified", "equipment_requirements_not_verified",
                             "task_durations_not_verified", "storage_transport_reheat_evidence_missing"])
                evidence.update({"ingredients": ingredients, "servings": row.get("servings"),
                                 "steps": row.get("steps", []), "kitchenware": equipment,
                                 "estimated_minutes": row.get("estimated_minutes"),
                                 "storage_transport_reheat": None,
                                 "source_cooking_review_status": row.get("cooking_review_status")})
            if collection != "kitchenware":
                # Do not promote the raw USDA candidates (including negative observations).
                if row.get("nutrition") is not None:
                    raise ValueError("Unexpected nutrition in locked clean record: " + row["id"])
                evidence["nutrition"] = None
                gaps.append("nutrition_unknown")
            else:
                gaps.append("equipment_capacity_and_substitution_not_verified")
            reviews.append({"id": row["id"], "collection": collection,
                            "disposition": "pending_evidence", "automatic_execution_allowed": False,
                            "can_display": row.get("can_display", True),
                            "review_method": "archive_evidence_inventory_v1",
                            "evidence": evidence, "missing_or_unverified": sorted(set(gaps))})
        results[collection] = reviews
    return results


def build(archive, output):
    lock = json.loads((ROOT / "archive.lock.json").read_bytes())
    sources = (ROOT / "sources.lock.json").read_bytes()
    files = verified_files(archive, lock, sources)
    reviews = audit(files)
    payload = {f"review/{key}.json": encoded(value) for key, value in reviews.items()}
    payload["archive.lock.json"] = encoded(lock)
    payload["sources.lock.json"] = sources
    payload["report.json"] = encoded({
        "format_version": 1, "source_archive_sha256": lock["sha256"],
        "builder_sha256": digest(Path(__file__).read_bytes()),
        "counts": {key: len(value) for key, value in reviews.items()},
        "execution_eligible": 0, "semantic_approval": False,
        "note": "Every source record has an evidence disposition. No cooking, licensing or device verification is asserted.",
    })
    payload["manifest.json"] = encoded({"files": [
        {"path": name, "sha256": digest(data), "bytes": len(data)}
        for name, data in sorted(payload.items())]})
    # Fixed metadata, ordering and no platform-dependent compression output.
    # Never overwrite an existing evidence artifact.
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_STORED) as z:
        for name, content in sorted(payload.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, content)
    return digest(Path(output).read_bytes())


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: audit.py LOCKED_RC7.zip NEW_OUTPUT.zip")
    print(build(sys.argv[1], sys.argv[2]))
