#!/usr/bin/env python3
"""Bulk-seed ingredients / recipes / kitchenware into the native Go SQLite schema.

Sources (real, licensed / public APIs — not fabricated rows):
  - Open Food Facts (ODbL 1.0) — packaged foods with nutrition + front images
  - Taiwan FDA nutrition dataset (OGDL 1.0)
  - Anduin2017/HowToCook (Unlicense) — Chinese recipes + dish images
  - zh / en Wikibooks cookbooks (CC BY-SA 4.0) — structured recipe pages
  - Open Products Facts (ODbL 1.0) — kitchen appliance / utensil products + images
  - Frozen concept kitchenware baseline from datasets/releases when present

Usage:
  python3 -I scripts/bulk-seed-go-catalog.py --database server/data/dietdigidose.db
  python3 -I scripts/bulk-seed-go-catalog.py --database server/data/dietdigidose.db --ingredients 12000 --recipes 12000 --kitchenware 12000
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UA = "DietDigiDose/1.0 (catalog-bulk-seed; +https://github.com/heathcetide/DietDigiDose; local research import)"
OFF_HOSTS = [
    "https://world.openfoodfacts.org/api/v2/search",
    "https://world.openfoodfacts.net/api/v2/search",
]
OPF_SEARCH = "https://world.openproductsfacts.org/api/v2/search"
TFDA_CSV = "https://data.fda.gov.tw/opendata/exportDataList.do?InfoId=20&logType=2&method=ExportData"
HOWTOCOOK_REPO = "https://github.com/Anduin2017/HowToCook.git"
MEDIA_HOWTOCOOK = "https://media.githubusercontent.com/media/Anduin2017/HowToCook"
USDA_FOUNDATION_ZIP = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2024-04-18.zip"
USDA_SR_LEGACY_ZIP = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip"

ADDITIVE_COLUMNS = [
    ("ingredients_library", "image_url", "TEXT"),
    ("ingredients_library", "brands", "TEXT"),
    ("ingredients_library", "micronutrients_json", "TEXT"),
    ("ingredients_library", "normalized_name", "TEXT"),
    ("ingredients_library", "original_name", "TEXT"),
    ("ingredients_library", "deleted_at", "TEXT"),
    ("ingredients_library", "deleted_by", "INTEGER"),
    ("ingredients_library", "aliases_json", "TEXT DEFAULT '[]'"),
    ("ingredients_library", "source_version", "TEXT"),
    ("ingredients_library", "data_license", "TEXT"),
    ("ingredients_library", "quality_status", "TEXT DEFAULT 'needs_review'"),
    ("ingredients_library", "nutrition_basis", "TEXT DEFAULT 'unknown'"),
    ("ingredients_library", "base_data_payload", "TEXT"),
    ("recipes", "source", "TEXT"),
    ("recipes", "source_url", "TEXT"),
    ("recipes", "source_revision", "TEXT"),
    ("recipes", "data_license", "TEXT"),
    ("recipes", "external_id", "TEXT"),
    ("recipes", "status", "TEXT DEFAULT 'approved'"),
    ("recipes", "quality_status", "TEXT DEFAULT 'trusted'"),
    ("recipes", "serving_size", "REAL"),
    ("recipes", "automatic_inventory_write_allowed", "INTEGER NOT NULL DEFAULT 1"),
    ("recipes", "base_data_payload", "TEXT"),
    ("recipes", "image_url", "TEXT"),
    ("recipes", "description", "TEXT"),
    ("recipes", "cook_time", "INTEGER"),
    ("recipes", "calories", "INTEGER"),
    ("recipes", "protein", "REAL"),
    ("recipes", "carbs", "REAL"),
    ("recipes", "fat", "REAL"),
    ("recipes", "category", "TEXT"),
    ("recipes", "tags", "TEXT"),
    ("recipes", "deleted_at", "TEXT"),
    ("kitchenware_catalog", "source", "TEXT"),
    ("kitchenware_catalog", "quality_status", "TEXT DEFAULT 'needs_review'"),
    ("kitchenware_catalog", "base_data_payload", "TEXT"),
    ("kitchenware_catalog", "aliases", "TEXT DEFAULT '[]'"),
    ("kitchenware_catalog", "barcode", "TEXT"),
    ("kitchenware_catalog", "brands", "TEXT"),
]


def log(msg: str) -> None:
    print(msg, flush=True)


def http_json(url: str, retries: int = 4) -> dict:
    last = "unknown"
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # noqa: BLE001 — network retries
            last = str(err)
            time.sleep(attempt * 1.2)
    raise RuntimeError(f"HTTP JSON failed for {url}: {last}")


def http_bytes(url: str, retries: int = 3) -> bytes:
    last = "unknown"
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except Exception as err:  # noqa: BLE001
            last = str(err)
            time.sleep(attempt)
    raise RuntimeError(f"HTTP download failed for {url}: {last}")


def ensure_columns(db: sqlite3.Connection) -> None:
    for table, name, typ in ADDITIVE_COLUMNS:
        cols = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
        if name not in cols:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {typ}")
    db.commit()


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", "", value.strip().lower())


def category_for_off(tags: list[str] | None) -> str:
    text = " ".join(tags or []).lower()
    if re.search(r"fruit|vegetable|mushroom|plant-based-food", text):
        return "蔬菜水果"
    if re.search(r"fish|meat|poultry|seafood|egg", text):
        return "肉食蛋类"
    if re.search(r"milk|cheese|yogurt|dairy", text):
        return "乳制品"
    if re.search(r"cereal|bread|pasta|rice|grain|flour", text):
        return "粮油干货"
    if re.search(r"nut|seed|legume|bean", text):
        return "坚果豆类"
    if re.search(r"beverage|drink|water", text):
        return "饮品"
    return "其他食品"


def num_at(nutriments: dict, key: str) -> float:
    value = nutriments.get(f"{key}_100g", nutriments.get(key))
    return float(value) if isinstance(value, (int, float)) else 0.0


def upsert_off_product(db: sqlite3.Connection, product: dict) -> str | None:
    barcode = (product.get("code") or "").strip()
    nutriments = product.get("nutriments") or {}
    if not barcode or not isinstance(nutriments, dict) or not nutriments:
        return None
    base = (
        product.get("product_name_zh_cn")
        or product.get("product_name_zh")
        or product.get("product_name")
        or ""
    ).strip()
    if not base:
        return None
    brand = (product.get("brands") or "").strip() or None
    name = f"{base}（{brand}）" if brand else base
    image = product.get("image_front_url") or product.get("image_url")
    calories = num_at(nutriments, "energy-kcal")
    protein = num_at(nutriments, "proteins")
    carbs = num_at(nutriments, "carbohydrates")
    fat = num_at(nutriments, "fat")
    if calories < 0 or calories > 900 or protein < 0 or carbs < 0 or fat < 0:
        return None
    row = db.execute(
        "SELECT id FROM ingredients_library WHERE barcode=? AND IFNULL(deleted_at,'')='' LIMIT 1",
        (barcode,),
    ).fetchone()
    if row:
        db.execute(
            """UPDATE ingredients_library SET
              calories_100g=?, protein_100g=?, carbs_100g=?, fat_100g=?,
              image_url=COALESCE(?, image_url), brands=COALESCE(?, brands),
              data_license='ODbL-1.0', quality_status='trusted',
              nutrition_basis='per_100g', source_version=?, deleted_at=NULL
            WHERE id=?""",
            (calories, protein, carbs, fat, image, brand, f"off-{time.strftime('%Y-%m-%d')}", row[0]),
        )
        return "updated"
    db.execute(
        """INSERT INTO ingredients_library (
          name, category, unit, calories_100g, protein_100g, carbs_100g, fat_100g,
          image_url, source, barcode, brands, data_license, normalized_name,
          quality_status, source_version, nutrition_basis, original_name
        ) VALUES (?, ?, 'g', ?, ?, ?, ?, ?, 'open_food_facts', ?, ?, 'ODbL-1.0', ?,
          'trusted', ?, 'per_100g', ?)""",
        (
            name, category_for_off(product.get("categories_tags")),
            calories, protein, carbs, fat, image, barcode, brand,
            normalize_name(name), f"off-{time.strftime('%Y-%m-%d')}", base,
        ),
    )
    return "inserted"


def import_open_food_facts(db: sqlite3.Connection, target: int) -> dict:
    total = db.execute(
        "SELECT COUNT(*) FROM ingredients_library WHERE IFNULL(deleted_at,'')=''"
    ).fetchone()[0]
    needed = max(0, target - total)
    if needed == 0:
        return {"inserted": 0, "updated": 0, "total": total}
    inserted = updated = scanned = 0
    page_size = 100
    fields = ",".join([
        "code", "product_name", "product_name_zh", "product_name_zh_cn", "brands",
        "categories_tags", "image_front_url", "image_url", "nutriments",
    ])
    # Search API hard-caps around page 10 (~1000 hits/query). Use many facets.
    categories = [
        "plant-based-foods-and-beverages", "meats", "dairies", "cereals-and-potatoes", "snacks",
        "beverages", "seafood", "fruits", "vegetables", "nuts", "breakfasts", "frozen-foods",
        "canned-foods", "spreads", "sauces", "condiments", "desserts", "chocolates", "cheeses",
        "yogurts", "milks", "breads", "pastas", "rices", "noodles", "soups", "meals",
        "baby-foods", "dietary-supplements", "plant-based-foods", "fresh-foods", "dried-products",
        "legumes", "seeds", "oils", "fats", "sweeteners", "waters", "juices", "teas", "coffees",
        "biscuits", "cakes", "pastries", "ice-creams", "pizzas", "sandwiches", "salads",
    ]
    queries = (
        [{"countries_tags_en": "china"}, {"languages_tags": "zh"}]
        + [{"categories_tags_en": c} for c in categories]
        + [{"countries_tags_en": c} for c in [
            "united-states", "france", "germany", "united-kingdom", "japan", "south-korea",
            "canada", "australia", "spain", "italy", "brazil", "india", "mexico", "taiwan",
        ]]
    )
    host_idx = 0
    for query in queries:
        page = 1
        empty_streak = 0
        while inserted < needed and page <= 10:
            params = {
                "fields": fields,
                "nutrition_data_per": "100g",
                "page_size": str(page_size),
                "page": str(page),
            }
            params.update(query)
            body = None
            last_err = None
            for _ in range(len(OFF_HOSTS)):
                host = OFF_HOSTS[host_idx % len(OFF_HOSTS)]
                url = host + "?" + urllib.parse.urlencode(params)
                try:
                    body = http_json(url, retries=2)
                    break
                except Exception as err:  # noqa: BLE001
                    last_err = err
                    host_idx += 1
                    time.sleep(2)
            if body is None:
                log(f"OFF page {page} failed: {last_err}")
                empty_streak += 1
                if empty_streak >= 3:
                    break
                page += 1
                continue
            products = body.get("products") or []
            if not products:
                break
            page_inserted = 0
            for product in products:
                scanned += 1
                action = upsert_off_product(db, product)
                if action == "inserted":
                    inserted += 1
                    page_inserted += 1
                    if inserted >= needed:
                        break
                elif action == "updated":
                    updated += 1
            db.commit()
            log(f"OFF page={page} query={query or 'global'} inserted={inserted}/{needed} updated={updated}")
            empty_streak = 0 if page_inserted else empty_streak + 1
            if empty_streak >= 5:
                break
            page += 1
            time.sleep(0.8)
        if inserted >= needed:
            break
    return {"inserted": inserted, "updated": updated, "scanned": scanned, "total_before": total}


def _usda_nutrient_map(food: dict) -> dict[str, float]:
    wanted = {
        "Energy": "calories",
        "Protein": "protein",
        "Carbohydrate, by difference": "carbs",
        "Total lipid (fat)": "fat",
    }
    out = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}
    for item in food.get("foodNutrients") or []:
        nutrient = item.get("nutrient") or {}
        name = nutrient.get("name") or item.get("nutrientName") or ""
        key = wanted.get(name)
        if not key:
            continue
        amount = item.get("amount", item.get("value"))
        unit = (nutrient.get("unitName") or item.get("unitName") or "").lower()
        if not isinstance(amount, (int, float)):
            continue
        if key == "calories" and unit == "kj":
            amount = amount / 4.184
        out[key] = float(amount)
    return out


def import_usda_fdc(db: sqlite3.Connection, target: int) -> dict:
    total = db.execute(
        "SELECT COUNT(*) FROM ingredients_library WHERE IFNULL(deleted_at,'')=''"
    ).fetchone()[0]
    needed = max(0, target - total)
    if needed == 0:
        return {"inserted": 0, "needed": 0}
    cache = ROOT / "datasets" / "cache" / "usda"
    cache.mkdir(parents=True, exist_ok=True)
    inserted = updated = 0
    for label, url, source in [
        ("foundation", USDA_FOUNDATION_ZIP, "usda_fdc_foundation"),
        ("sr_legacy", USDA_SR_LEGACY_ZIP, "usda_fdc_sr_legacy"),
    ]:
        if inserted >= needed:
            break
        zip_path = cache / f"{label}.zip"
        if not zip_path.exists() or zip_path.stat().st_size < 1000:
            log(f"Downloading USDA {label}…")
            zip_path.write_bytes(http_bytes(url, retries=4))
        with zipfile.ZipFile(zip_path) as zf:
            member = next((n for n in zf.namelist() if n.endswith(".json")), None)
            if not member:
                continue
            log(f"Parsing USDA {label} ({member})…")
            payload = json.loads(zf.read(member))
        foods = payload.get("FoundationFoods") or payload.get("SRLegacyFoods") or payload.get("foods") or []
        for food in foods:
            fdc_id = str(food.get("fdcId") or food.get("ndbNumber") or "")
            name = (food.get("description") or "").strip()
            if not fdc_id or not name:
                continue
            nuts = _usda_nutrient_map(food)
            row = db.execute(
                "SELECT id FROM ingredients_library WHERE source=? AND source_ref=? LIMIT 1",
                (source, fdc_id),
            ).fetchone()
            category = (food.get("foodCategory", {}) or {}).get("description") if isinstance(food.get("foodCategory"), dict) else (food.get("foodCategory") or "USDA")
            if isinstance(category, dict):
                category = category.get("description") or "USDA"
            if row:
                db.execute(
                    """UPDATE ingredients_library SET calories_100g=?, protein_100g=?, carbs_100g=?, fat_100g=?,
                      data_license='CC0-1.0', quality_status='reference', nutrition_basis='per_100g' WHERE id=?""",
                    (nuts["calories"], nuts["protein"], nuts["carbs"], nuts["fat"], row[0]),
                )
                updated += 1
            else:
                db.execute(
                    """INSERT INTO ingredients_library (
                      name, category, unit, calories_100g, protein_100g, carbs_100g, fat_100g,
                      source, source_ref, data_license, normalized_name, quality_status, nutrition_basis
                    ) VALUES (?, ?, 'g', ?, ?, ?, ?, ?, ?, 'CC0-1.0', ?, 'reference', 'per_100g')""",
                    (
                        name, category or "USDA", nuts["calories"], nuts["protein"], nuts["carbs"], nuts["fat"],
                        source, fdc_id, normalize_name(name),
                    ),
                )
                inserted += 1
                if inserted >= needed:
                    break
        db.commit()
        log(f"USDA {label}: inserted={inserted} updated={updated}")
    return {"inserted": inserted, "updated": updated, "needed": needed}


def parse_csv_line(line: str) -> list[str]:
    values: list[str] = []
    value = ""
    quoted = False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == '"' and quoted and i + 1 < len(line) and line[i + 1] == '"':
            value += '"'
            i += 2
            continue
        if ch == '"':
            quoted = not quoted
        elif ch == "," and not quoted:
            values.append(value)
            value = ""
        else:
            value += ch
        i += 1
    values.append(value)
    return values


def import_taiwan_fda(db: sqlite3.Connection) -> dict:
    work = Path(tempfile.mkdtemp(prefix="tfda-"))
    try:
        zip_path = work / "nutrition.zip"
        zip_path.write_bytes(http_bytes(TFDA_CSV))
        with zipfile.ZipFile(zip_path) as zf:
            member = next((n for n in zf.namelist() if n.endswith(".csv")), None)
            if not member:
                raise RuntimeError("TFDA zip missing csv")
            csv_text = zf.read(member).decode("utf-8-sig")
        header: list[str] = []
        current_id = ""
        name = ""
        category = ""
        nutrients: dict[str, float] = {}
        inserted = updated = 0

        def flush() -> None:
            nonlocal inserted, updated
            if not current_id or not name:
                return

            def macro(pattern: str) -> float:
                for key, val in nutrients.items():
                    if re.search(pattern, key):
                        return val
                return 0.0

            calories = macro(r"熱量|热量")
            protein = macro(r"粗蛋白|^蛋白質$|^蛋白质$")
            carbs = macro(r"總碳水|总碳水|^碳水")
            fat = macro(r"粗脂肪|^脂肪$")
            row = db.execute(
                "SELECT id FROM ingredients_library WHERE source='taiwan_fda' AND source_ref=? LIMIT 1",
                (current_id,),
            ).fetchone()
            if not row:
                row = db.execute(
                    "SELECT id FROM ingredients_library WHERE name=? AND source='taiwan_fda' AND IFNULL(deleted_at,'')='' LIMIT 1",
                    (name,),
                ).fetchone()
            if row:
                db.execute(
                    """UPDATE ingredients_library SET calories_100g=?, protein_100g=?, carbs_100g=?, fat_100g=?,
                      category=COALESCE(?, category), data_license='OGDL-1.0', quality_status='reference',
                      nutrition_basis='source_sample', source_ref=? WHERE id=?""",
                    (calories, protein, carbs, fat, category or None, current_id, row[0]),
                )
                updated += 1
            else:
                db.execute(
                    """INSERT INTO ingredients_library (
                      name, category, unit, calories_100g, protein_100g, carbs_100g, fat_100g,
                      source, source_ref, data_license, normalized_name, quality_status, nutrition_basis
                    ) VALUES (?, ?, 'g', ?, ?, ?, ?, 'taiwan_fda', ?, 'OGDL-1.0', ?, 'reference', 'source_sample')""",
                    (name, category or "其他食品", calories, protein, carbs, fat, current_id, normalize_name(name)),
                )
                inserted += 1

        for line in csv_text.splitlines():
            row = parse_csv_line(line)
            if not header:
                header = row
                continue
            at = {header[i]: row[i] if i < len(row) else "" for i in range(len(header))}
            sample_id = at.get("整合編號", "")
            if sample_id != current_id:
                flush()
                current_id = sample_id
                name = at.get("樣品名稱") or at.get("俗名") or ""
                category = at.get("食品分類", "")
                nutrients = {}
            nutrient = at.get("分析項", "")
            amount = at.get("每100克含量", "")
            if nutrient and amount and amount != "Tr":
                try:
                    nutrients[nutrient] = float(amount)
                except ValueError:
                    pass
        flush()
        db.commit()
        return {"inserted": inserted, "updated": updated}
    finally:
        for path in work.rglob("*"):
            if path.is_file():
                path.unlink(missing_ok=True)
        work.rmdir()


def clone_howtocook(cache: Path) -> tuple[Path, str]:
    persistent = ROOT / "datasets" / "cache" / "HowToCook"
    repo = persistent if (persistent / ".git").exists() else (cache / "HowToCook")
    if not (repo / ".git").exists():
        persistent.parent.mkdir(parents=True, exist_ok=True)
        subprocess.check_call(["git", "clone", "--depth", "1", HOWTOCOOK_REPO, str(persistent)])
        repo = persistent
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(repo), text=True).strip()
    return repo, revision


def parse_howtocook_md(path: Path, repo: Path, revision: str) -> dict | None:
    text = path.read_text(encoding="utf-8", errors="ignore")
    rel = path.relative_to(repo).as_posix()
    if any(part in rel for part in ("/drink/", "/condiment/", "/template/")):
        return None
    title_match = re.search(r"^#\s+(.+)$", text, re.M)
    if not title_match:
        return None
    title = re.sub(r"的做法$", "", title_match.group(1).strip())
    ingredients: list[dict] = []
    steps: list[str] = []
    section = ""
    for line in text.splitlines():
        heading = re.match(r"^##\s*(.+)$", line)
        if heading:
            section = heading.group(1).strip()
            continue
        bullet = re.match(r"^[-*]\s+(.+)$", line.strip())
        numbered = re.match(r"^\d+[\.、\)]\s+(.+)$", line.strip())
        if section.startswith("计算") and bullet:
            item = bullet.group(1).strip()
            # Prefer quantified lines under 计算 / 每份.
            m = re.match(r"^(.+?)\s+(\d+(?:\.\d+)?\s*[a-zA-Z一-龥%]+)$", item)
            if m:
                ingredients.append({"name": m.group(1).strip(), "amount": m.group(2).strip()})
            elif " = " not in item and "份数" not in item and len(item) < 40:
                ingredients.append({"name": item, "amount": ""})
            continue
        if re.search(r"原料|食材|工具", section) and bullet and not ingredients:
            item = bullet.group(1).strip()
            if item and len(item) < 40:
                ingredients.append({"name": item, "amount": ""})
            continue
        if section.startswith("操作") or section.startswith("步骤") or section.startswith("做法"):
            if numbered:
                steps.append(numbered.group(1).strip())
            elif bullet:
                steps.append(bullet.group(1).strip())
    # Deduplicate ingredient names while keeping order.
    seen = set()
    uniq: list[dict] = []
    for item in ingredients:
        key = item["name"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(item)
    ingredients = uniq
    if len(ingredients) < 2 or len(steps) < 2:
        return None
    image = None
    img = re.search(r"!\[[^\]]*\]\(([^)]+)\)", text)
    if img:
        src = img.group(1)
        if src.startswith("http"):
            image = src
        else:
            abs_img = (path.parent / src).resolve()
            try:
                rel_img = abs_img.relative_to(repo).as_posix()
            except ValueError:
                rel_img = src.lstrip("./")
            image = f"{MEDIA_HOWTOCOOK}/{revision}/{urllib.parse.quote(rel_img)}"
    # Group folder is dishes/<group>/...
    parts = path.relative_to(repo / "dishes").parts
    group = parts[0] if parts else ""
    category_map = {
        "vegetable_dish": "减脂",
        "staple": "营养餐单",
        "meat_dish": "增肌",
        "soup": "营养餐单",
        "aquatic": "增肌",
        "breakfast": "营养餐单",
        "dessert": "营养餐单",
        "semi-finished": "快手菜",
    }
    return {
        "external_id": hashlib.sha1(rel.encode()).hexdigest()[:16],
        "title": title,
        "summary": f"来自 HowToCook：{title}",
        "cover_image_url": image,
        "cook_time_minutes": 30,
        "difficulty": "medium",
        "ingredients_json": json.dumps(ingredients, ensure_ascii=False),
        "steps_json": json.dumps(steps, ensure_ascii=False),
        "source": "howtocook",
        "source_url": f"https://github.com/Anduin2017/HowToCook/blob/{revision}/{rel}",
        "source_revision": revision,
        "data_license": "Unlicense",
        "status": "approved",
        "quality_status": "reference",
        "category": category_map.get(group, "营养餐单"),
        "image_url": image,
        "description": f"来自 HowToCook：{title}",
        "cook_time": 30,
    }


def upsert_recipe(db: sqlite3.Connection, recipe: dict) -> str:
    row = db.execute(
        "SELECT id FROM recipes WHERE source=? AND external_id=? LIMIT 1",
        (recipe["source"], recipe["external_id"]),
    ).fetchone()
    cols = {
        "title": recipe["title"],
        "summary": recipe.get("summary"),
        "cover_image_url": recipe.get("cover_image_url"),
        "cook_time_minutes": recipe.get("cook_time_minutes"),
        "difficulty": recipe.get("difficulty"),
        "ingredients_json": recipe.get("ingredients_json"),
        "steps_json": recipe.get("steps_json"),
        "source": recipe["source"],
        "source_url": recipe.get("source_url"),
        "source_revision": recipe.get("source_revision"),
        "data_license": recipe.get("data_license"),
        "external_id": recipe["external_id"],
        "status": recipe.get("status", "approved"),
        "quality_status": recipe.get("quality_status", "reference"),
        "image_url": recipe.get("image_url"),
        "description": recipe.get("description"),
        "cook_time": recipe.get("cook_time"),
        "category": recipe.get("category"),
        "tags": recipe.get("tags"),
        "calories": recipe.get("calories"),
        "protein": recipe.get("protein"),
        "carbs": recipe.get("carbs"),
        "fat": recipe.get("fat"),
        "serving_size": recipe.get("serving_size"),
    }
    # Drop unknown columns for older/partial schemas.
    existing_cols = {r[1] for r in db.execute("PRAGMA table_info(recipes)")}
    cols = {k: v for k, v in cols.items() if k in existing_cols}
    if row:
        sets = ", ".join(f"{k}=?" for k in cols if k not in {"source", "external_id"})
        values = [v for k, v in cols.items() if k not in {"source", "external_id"}]
        db.execute(f"UPDATE recipes SET {sets} WHERE id=?", (*values, row[0]))
        return "updated"
    keys = list(cols.keys())
    db.execute(
        f"INSERT INTO recipes ({', '.join(keys)}) VALUES ({', '.join('?' for _ in keys)})",
        [cols[k] for k in keys],
    )
    return "inserted"


def import_howtocook(db: sqlite3.Connection, cache: Path) -> dict:
    repo, revision = clone_howtocook(cache)
    dishes = repo / "dishes"
    inserted = updated = 0
    for path in sorted(dishes.rglob("*.md")):
        recipe = parse_howtocook_md(path, repo, revision)
        if not recipe:
            continue
        action = upsert_recipe(db, recipe)
        inserted += action == "inserted"
        updated += action == "updated"
    db.commit()
    return {"inserted": inserted, "updated": updated, "revision": revision}


def wiki_category_members(api: str, category: str, limit: int) -> list[dict]:
    members: list[dict] = []
    cont = None
    while len(members) < limit:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": category,
            "cmlimit": "500",
            "cmtype": "page|subcat",
            "format": "json",
        }
        if cont:
            params["cmcontinue"] = cont
        body = http_json(api + "?" + urllib.parse.urlencode(params))
        batch = body.get("query", {}).get("categorymembers", [])
        members.extend(batch)
        cont = body.get("continue", {}).get("cmcontinue")
        if not cont or not batch:
            break
        time.sleep(0.15)
    return members[:limit]


def wiki_fetch_pages(api: str, pageids: list[int]) -> list[dict]:
    out: list[dict] = []
    for i in range(0, len(pageids), 20):
        chunk = pageids[i : i + 20]
        params = {
            "action": "query",
            "prop": "revisions",
            "rvslots": "main",
            "rvprop": "content|ids|timestamp",
            "pageids": "|".join(str(x) for x in chunk),
            "format": "json",
        }
        body = http_json(api + "?" + urllib.parse.urlencode(params))
        pages = body.get("query", {}).get("pages", {})
        out.extend(pages.values())
        time.sleep(0.15)
    return out


def parse_wikibooks_recipe(page: dict, source: str, site: str) -> dict | None:
    title = (page.get("title") or "").strip()
    if not title or title.startswith("Category:"):
        return None
    revs = page.get("revisions") or []
    if not revs:
        return None
    rev = revs[0]
    content = ((rev.get("slots") or {}).get("main") or {}).get("*") or rev.get("*") or ""
    if not content or len(content) < 80:
        return None
    ingredients: list[dict] = []
    steps: list[str] = []
    for line in content.splitlines():
        if re.match(r"^\*\s+", line) and len(ingredients) < 40:
            item = re.sub(r"^\*\s+", "", line).strip()
            item = re.sub(r"\[\[([^|\]]+\|)?([^\]]+)\]\]", r"\2", item)
            item = re.sub(r"<[^>]+>", "", item)
            if item and not item.startswith("="):
                ingredients.append({"name": item[:80], "amount": ""})
        if re.match(r"^#\s+", line):
            step = re.sub(r"^#\s+", "", line).strip()
            step = re.sub(r"\[\[([^|\]]+\|)?([^\]]+)\]\]", r"\2", step)
            step = re.sub(r"<[^>]+>", "", step)
            if step:
                steps.append(step)
    if len(ingredients) < 2 or len(steps) < 2:
        return None
    pageid = page.get("pageid")
    revid = rev.get("revid")
    return {
        "external_id": str(pageid),
        "title": title.replace("Cookbook:", "").replace("食譜:", "").strip(),
        "summary": f"来自 Wikibooks（{source}）",
        "cover_image_url": None,
        "cook_time_minutes": 30,
        "difficulty": "medium",
        "ingredients_json": json.dumps(ingredients, ensure_ascii=False),
        "steps_json": json.dumps(steps, ensure_ascii=False),
        "source": source,
        "source_url": f"{site}/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
        "source_revision": str(revid),
        "data_license": "CC-BY-SA-4.0",
        "status": "approved",
        "quality_status": "reference",
        "category": "营养餐单",
        "description": f"来自 Wikibooks：{title}",
        "cook_time": 30,
    }


def import_wikibooks(db: sqlite3.Connection, target_total: int) -> dict:
    total = db.execute("SELECT COUNT(*) FROM recipes WHERE IFNULL(deleted_at,'')=''").fetchone()[0]
    needed = max(0, target_total - total)
    if needed == 0:
        return {"inserted": 0, "updated": 0, "total": total}
    inserted = updated = 0
    sources = [
        ("https://zh.wikibooks.org/w/api.php", "Category:食譜", "wikibooks_zh", "https://zh.wikibooks.org"),
        ("https://en.wikibooks.org/w/api.php", "Category:Recipes", "wikibooks_en", "https://en.wikibooks.org"),
        ("https://en.wikibooks.org/w/api.php", "Category:Cookbook", "wikibooks_en", "https://en.wikibooks.org"),
        ("https://en.wikibooks.org/w/api.php", "Category:Cuisine", "wikibooks_en", "https://en.wikibooks.org"),
    ]
    for api, category, source, site in sources:
        if inserted >= needed:
            break
        members = wiki_category_members(api, category, limit=5000)
        subcats = [m for m in members if str(m.get("title", "")).startswith("Category:")]
        pages = [m for m in members if not str(m.get("title", "")).startswith("Category:")]
        # Deepen two levels of Cookbook category trees to accumulate real pages.
        queue = list(subcats[:200])
        seen_cats = {category}
        while queue and len(pages) < needed * 4:
            sub = queue.pop(0)
            title = sub.get("title")
            if not title or title in seen_cats:
                continue
            seen_cats.add(title)
            child = wiki_category_members(api, title, limit=500)
            for m in child:
                t = str(m.get("title", ""))
                if t.startswith("Category:"):
                    if len(seen_cats) < 800:
                        queue.append(m)
                else:
                    pages.append(m)
            time.sleep(0.08)
        page_ids = list(dict.fromkeys(int(m["pageid"]) for m in pages if m.get("pageid")))
        log(f"Wikibooks crawl {source}/{category}: pages={len(page_ids)}")
        for page in wiki_fetch_pages(api, page_ids):
            recipe = parse_wikibooks_recipe(page, source, site)
            if not recipe:
                continue
            action = upsert_recipe(db, recipe)
            inserted += action == "inserted"
            updated += action == "updated"
            if inserted >= needed:
                break
        db.commit()
        log(f"Wikibooks {source}/{category}: inserted={inserted} updated={updated}")
    return {"inserted": inserted, "updated": updated, "total_before": total}


def import_system_package_recipes(db: sqlite3.Connection) -> dict:
    archive = ROOT / "datasets/releases/system-data-2026-09-15.2.zip"
    if not archive.exists():
        return {"inserted": 0, "skipped": "archive_missing"}
    inserted = updated = 0
    with zipfile.ZipFile(archive) as zf:
        data = json.loads(zf.read("system-data-2026-09-15.2/data/runtime-input.json"))
    original = {r["id"]: r for r in data["baseline"]["recipes"]}
    for method in data["methods"]:
        recipe_src = original.get(method["source_method_id"], {})
        title = method.get("title") or recipe_src.get("title")
        if not title:
            continue
        ingredients = [
            {
                "name": i.get("name") or i.get("name_zh") or "食材",
                "amount": i.get("amount_text") or i.get("amount") or "",
            }
            for i in method.get("ingredients") or []
        ]
        steps = [s.get("text") or s.get("instruction") or "" for s in method.get("steps") or []]
        steps = [s for s in steps if s]
        if len(ingredients) < 1 or len(steps) < 1:
            continue
        source = method.get("source") or {}
        recipe = {
            "external_id": method["id"],
            "title": title,
            "summary": "做法参考（system-data 冻结包），尚未完成制作审核。",
            "cover_image_url": None,
            "cook_time_minutes": recipe_src.get("estimated_minutes") or 30,
            "difficulty": recipe_src.get("difficulty") or "medium",
            "ingredients_json": json.dumps(ingredients, ensure_ascii=False),
            "steps_json": json.dumps(steps, ensure_ascii=False),
            "source": "concept_base",
            "source_url": source.get("source_url"),
            "source_revision": data.get("version"),
            "data_license": source.get("source_license"),
            "status": "pending",
            "quality_status": "needs_review",
            "category": "营养餐单",
            "description": "做法参考（system-data 冻结包）",
            "cook_time": recipe_src.get("estimated_minutes") or 30,
            "serving_size": method.get("servings"),
        }
        action = upsert_recipe(db, recipe)
        inserted += action == "inserted"
        updated += action == "updated"
    db.commit()
    return {"inserted": inserted, "updated": updated}


def import_recipe_nlg(db: sqlite3.Connection, target_total: int) -> dict:
    """Import real RecipeNLG / Food.com-style rows from a public CSV dump."""
    total = db.execute("SELECT COUNT(*) FROM recipes WHERE IFNULL(deleted_at,'')=''").fetchone()[0]
    needed = max(0, target_total - total)
    if needed == 0:
        return {"inserted": 0, "needed": 0}
    cache = ROOT / "datasets" / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    csv_path = cache / "recipe_nlg_full_dataset.csv"
    urls = [
        "https://huggingface.co/datasets/mbien/recipe_nlg/resolve/main/dataset/full_dataset.csv",
        "https://hf-mirror.com/datasets/mbien/recipe_nlg/resolve/main/dataset/full_dataset.csv",
    ]
    if not csv_path.exists() or csv_path.stat().st_size < 1_000_000:
        last_err = None
        for url in urls:
            try:
                log(f"Downloading RecipeNLG CSV from {url}…")
                # Stream to avoid holding multi-GB in memory if the mirror is large.
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=300) as resp, csv_path.open("wb") as out:
                    downloaded = 0
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                        downloaded += len(chunk)
                        if downloaded > 250_000_000:  # cap local cache at ~250MB for seed speed
                            break
                        if downloaded % (20 * 1024 * 1024) < 1024 * 1024:
                            log(f"  RecipeNLG downloaded {downloaded // (1024 * 1024)} MB…")
                break
            except Exception as err:  # noqa: BLE001
                last_err = err
                log(f"RecipeNLG download failed: {err}")
        else:
            # Fallback: datasets-server paging
            inserted = updated = 0
            offset = 0
            while inserted < needed and offset < needed + 20000:
                url = (
                    "https://datasets-server.huggingface.co/rows"
                    f"?dataset=mbien%2Frecipe_nlg&config=default&split=train&offset={offset}&length=100"
                )
                try:
                    body = http_json(url)
                except Exception as err:  # noqa: BLE001
                    log(f"RecipeNLG offset {offset} failed: {err}")
                    break
                rows = body.get("rows") or []
                if not rows:
                    break
                for entry in rows:
                    row = entry.get("row") or {}
                    action = _upsert_recipe_nlg_row(db, row)
                    inserted += action == "inserted"
                    updated += action == "updated"
                    if inserted >= needed:
                        break
                db.commit()
                offset += 100
                time.sleep(0.15)
            return {"inserted": inserted, "updated": updated, "needed": needed, "mode": "api", "error": str(last_err) if last_err else None}

    inserted = updated = 0
    import csv as csv_mod

    with csv_path.open("r", encoding="utf-8", errors="ignore", newline="") as fh:
        reader = csv_mod.DictReader(fh)
        for row in reader:
            action = _upsert_recipe_nlg_row(db, row)
            if action == "inserted":
                inserted += 1
            elif action == "updated":
                updated += 1
            if inserted and inserted % 500 == 0:
                db.commit()
                log(f"RecipeNLG csv inserted={inserted}/{needed}")
            if inserted >= needed:
                break
    db.commit()
    return {"inserted": inserted, "updated": updated, "needed": needed, "mode": "csv"}


def _upsert_recipe_nlg_row(db: sqlite3.Connection, row: dict) -> str | None:
    title = (row.get("title") or "").strip()
    ingredients = row.get("ingredients") or row.get("ner") or []
    instructions = row.get("directions") or row.get("instructions") or []
    if isinstance(ingredients, str):
        try:
            parsed = json.loads(ingredients)
            ingredients = parsed if isinstance(parsed, list) else [x.strip() for x in re.split(r"[\n|]", ingredients) if x.strip()]
        except json.JSONDecodeError:
            ingredients = [x.strip() for x in re.split(r"[\n|]", ingredients) if x.strip()]
    if isinstance(instructions, str):
        try:
            parsed = json.loads(instructions)
            instructions = parsed if isinstance(parsed, list) else [x.strip() for x in re.split(r"[\n|]", instructions) if x.strip()]
        except json.JSONDecodeError:
            instructions = [x.strip() for x in re.split(r"[\n|]", instructions) if x.strip()]
    if not title or len(ingredients) < 2 or len(instructions) < 2:
        return None
    external_id = hashlib.sha1(
        f"recipe_nlg:{title}:{len(ingredients)}:{len(instructions)}".encode()
    ).hexdigest()[:20]
    recipe = {
        "external_id": external_id,
        "title": title[:180],
        "summary": "RecipeNLG research corpus recipe",
        "cover_image_url": None,
        "cook_time_minutes": 30,
        "difficulty": "medium",
        "ingredients_json": json.dumps(
            [{"name": str(x)[:120], "amount": ""} for x in ingredients[:40]],
            ensure_ascii=False,
        ),
        "steps_json": json.dumps([str(x)[:500] for x in instructions[:40]], ensure_ascii=False),
        "source": "recipe_nlg",
        "source_url": "https://huggingface.co/datasets/mbien/recipe_nlg",
        "source_revision": "full_dataset.csv",
        "data_license": "research-corpus",
        "status": "approved",
        "quality_status": "reference",
        "category": "营养餐单",
        "description": "RecipeNLG research corpus recipe",
        "cook_time": 30,
    }
    return upsert_recipe(db, recipe)


def import_concept_kitchenware(db: sqlite3.Connection) -> dict:
    archive = ROOT / "datasets/releases/system-data-2026-09-15.2.zip"
    if not archive.exists():
        return {"inserted": 0, "skipped": "archive_missing"}
    inserted = updated = 0
    with zipfile.ZipFile(archive) as zf:
        data = json.loads(zf.read("system-data-2026-09-15.2/data/runtime-input.json"))
    concepts = {c["id"]: c for c in data["concepts"]}
    legacy = {(m["legacy_table"], m["legacy_id"]): m["concept_id"] for m in data["legacy-map"]}
    for tool in data["baseline"]["kitchenware"]:
        concept_id = legacy.get(("kitchenware", tool["id"]))
        concept = concepts.get(concept_id) if concept_id else None
        name = (concept or {}).get("name_zh") or tool.get("name") or tool.get("name_zh")
        if not name:
            continue
        category = tool.get("category") or "厨具"
        row = db.execute("SELECT id FROM kitchenware_catalog WHERE name=? LIMIT 1", (name,)).fetchone()
        payload = json.dumps({"concept": concept, "source_record": tool}, ensure_ascii=False)
        if row:
            db.execute(
                """UPDATE kitchenware_catalog SET category=?, source='concept_base', quality_status='reference',
                  description=COALESCE(description, ?), base_data_payload=? WHERE id=?""",
                (category, "目录参考；能力与替代关系尚未审核。", payload, row[0]),
            )
            updated += 1
        else:
            db.execute(
                """INSERT INTO kitchenware_catalog
                  (name, category, description, source, quality_status, base_data_payload)
                 VALUES (?, ?, ?, 'concept_base', 'reference', ?)""",
                (name, category, "目录参考；能力与替代关系尚未审核。", payload),
            )
            inserted += 1
    db.commit()
    return {"inserted": inserted, "updated": updated}


def import_wikidata_kitchenware(db: sqlite3.Connection, target: int) -> dict:
    """Import kitchen utensil / cookware concepts from Wikidata (CC0 metadata + optional Commons images)."""
    total = db.execute("SELECT COUNT(*) FROM kitchenware_catalog").fetchone()[0]
    needed = max(0, target - total)
    if needed == 0:
        return {"inserted": 0, "needed": 0}
    inserted = updated = 0
    # Kitchen utensil, cookware and baking utensil classes.
    classes = ["Q1521410", "Q182993", "Q182991", "Q2603706", "Q1148394"]
    endpoint = "https://query.wikidata.org/sparql"
    for qid in classes:
        if inserted >= needed:
            break
        sparql = f"""
        SELECT ?item ?itemLabel ?image WHERE {{
          ?item wdt:P31/wdt:P279* wd:{qid} .
          OPTIONAL {{ ?item wdt:P18 ?image }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "zh,en". }}
        }}
        LIMIT {min(needed * 2, 5000)}
        """
        url = endpoint + "?" + urllib.parse.urlencode({"query": sparql, "format": "json"})
        try:
            body = http_json(url, retries=3)
        except Exception as err:  # noqa: BLE001
            log(f"Wikidata {qid} failed: {err}")
            continue
        for row in body.get("results", {}).get("bindings", []):
            name = (row.get("itemLabel") or {}).get("value", "").strip()
            item = (row.get("item") or {}).get("value", "")
            image = (row.get("image") or {}).get("value")
            if not name or name.startswith("Q") or len(name) < 2:
                continue
            external = item.rsplit("/", 1)[-1]
            row_db = db.execute(
                "SELECT id FROM kitchenware_catalog WHERE barcode=? OR name=? LIMIT 1",
                (external, name),
            ).fetchone()
            if row_db:
                db.execute(
                    """UPDATE kitchenware_catalog SET image_url=COALESCE(?, image_url),
                      source=COALESCE(source, 'wikidata'), quality_status='reference' WHERE id=?""",
                    (image, row_db[0]),
                )
                updated += 1
            else:
                db.execute(
                    """INSERT INTO kitchenware_catalog
                      (name, category, description, image_url, source, quality_status, barcode)
                     VALUES (?, '厨具', ?, ?, 'wikidata', 'reference', ?)""",
                    (name, f"Wikidata {external}", image, external),
                )
                inserted += 1
                if inserted >= needed:
                    break
        db.commit()
        log(f"Wikidata {qid}: inserted={inserted} updated={updated}")
        time.sleep(1)
    return {"inserted": inserted, "updated": updated, "needed": needed}


def import_open_products_kitchenware(db: sqlite3.Connection, target: int) -> dict:
    existing = db.execute(
        "SELECT COUNT(*) FROM kitchenware_catalog WHERE source='open_products_facts'"
    ).fetchone()[0]
    needed = max(0, target - existing)
    if needed == 0:
        return {"inserted": 0, "updated": 0, "existing": existing}
    inserted = updated = scanned = 0
    page = 1
    fields = "code,product_name,product_name_zh,product_name_zh_cn,brands,categories_tags,image_url,image_front_url"
    # Broad kitchen / housewares queries — real product rows with barcodes.
    category_queries = [
        "kitchen",
        "cookware",
        "kitchen-utensils",
        "small-kitchen-appliances",
        "home-appliances",
        "tableware",
        "baking",
        "cutlery",
    ]
    for cat in category_queries:
        if inserted >= needed:
            break
        page = 1
        while inserted < needed and page <= 200:
            params = {
                "fields": fields,
                "page_size": "100",
                "page": str(page),
                "categories_tags_en": cat,
            }
            url = OPF_SEARCH + "?" + urllib.parse.urlencode(params)
            try:
                body = http_json(url)
            except Exception as err:  # noqa: BLE001
                log(f"OPF {cat} page {page} failed: {err}")
                break
            products = body.get("products") or []
            if not products:
                break
            for product in products:
                scanned += 1
                barcode = (product.get("code") or "").strip()
                base = (
                    product.get("product_name_zh_cn")
                    or product.get("product_name_zh")
                    or product.get("product_name")
                    or ""
                ).strip()
                if not barcode or not base:
                    continue
                brand = (product.get("brands") or "").strip() or None
                name = f"{base}（{brand}）" if brand else base
                image = product.get("image_front_url") or product.get("image_url")
                tags = " ".join(product.get("categories_tags") or [])
                category = "小家电" if re.search(r"appliance|microwave|oven|blender|fryer", tags, re.I) else "厨具"
                row = db.execute(
                    "SELECT id FROM kitchenware_catalog WHERE barcode=? LIMIT 1",
                    (barcode,),
                ).fetchone()
                if not row:
                    row = db.execute(
                        "SELECT id FROM kitchenware_catalog WHERE name=? LIMIT 1",
                        (name,),
                    ).fetchone()
                if row:
                    db.execute(
                        """UPDATE kitchenware_catalog SET image_url=COALESCE(?, image_url), brands=COALESCE(?, brands),
                          barcode=COALESCE(barcode, ?), source='open_products_facts', quality_status='reference',
                          category=COALESCE(NULLIF(category,''), ?) WHERE id=?""",
                        (image, brand, barcode, category, row[0]),
                    )
                    updated += 1
                else:
                    db.execute(
                        """INSERT INTO kitchenware_catalog
                          (name, category, description, image_url, source, quality_status, barcode, brands)
                         VALUES (?, ?, ?, ?, 'open_products_facts', 'reference', ?, ?)""",
                        (name, category, "Open Products Facts 商品目录条目", image, barcode, brand),
                    )
                    inserted += 1
                    if inserted >= needed:
                        break
            db.commit()
            log(f"OPF cat={cat} page={page} inserted={inserted}/{needed} updated={updated}")
            page += 1
            time.sleep(0.2)
    return {"inserted": inserted, "updated": updated, "scanned": scanned, "existing_before": existing}


def counts(db: sqlite3.Connection) -> dict:
    return {
        "ingredients_library": db.execute("SELECT COUNT(*) FROM ingredients_library WHERE IFNULL(deleted_at,'')=''").fetchone()[0],
        "recipes": db.execute("SELECT COUNT(*) FROM recipes WHERE IFNULL(deleted_at,'')=''").fetchone()[0],
        "kitchenware_catalog": db.execute("SELECT COUNT(*) FROM kitchenware_catalog").fetchone()[0],
        "ingredients_with_image": db.execute(
            "SELECT COUNT(*) FROM ingredients_library WHERE IFNULL(image_url,'')<>'' AND IFNULL(deleted_at,'')=''"
        ).fetchone()[0],
        "recipes_with_image": db.execute(
            "SELECT COUNT(*) FROM recipes WHERE (IFNULL(cover_image_url,'')<>'' OR IFNULL(image_url,'')<>'') AND IFNULL(deleted_at,'')=''"
        ).fetchone()[0],
        "kitchenware_with_image": db.execute(
            "SELECT COUNT(*) FROM kitchenware_catalog WHERE IFNULL(image_url,'')<>''"
        ).fetchone()[0],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=ROOT / "server/data/dietdigidose.db")
    parser.add_argument("--ingredients", type=int, default=12000)
    parser.add_argument("--recipes", type=int, default=12000)
    parser.add_argument("--kitchenware", type=int, default=12000)
    parser.add_argument("--skip-off", action="store_true")
    parser.add_argument("--skip-tfda", action="store_true")
    parser.add_argument("--skip-usda", action="store_true")
    parser.add_argument("--skip-howtocook", action="store_true")
    parser.add_argument("--skip-wikibooks", action="store_true")
    parser.add_argument("--skip-kitchenware", action="store_true")
    parser.add_argument("--skip-ingredients", action="store_true")
    args = parser.parse_args()
    if not args.database.is_file():
        raise SystemExit(f"database missing: {args.database}")

    db = sqlite3.connect(str(args.database), timeout=60)
    db.execute("PRAGMA busy_timeout=60000")
    ensure_columns(db)
    report: dict = {"before": counts(db)}
    cache = Path(tempfile.mkdtemp(prefix="ddd-catalog-"))

    try:
        if not args.skip_ingredients:
            if not args.skip_usda:
                log("=== USDA FoodData Central ingredients ===")
                try:
                    report["usda_fdc"] = import_usda_fdc(db, args.ingredients)
                except Exception as err:  # noqa: BLE001
                    report["usda_fdc"] = {"error": str(err)}
                    log(f"USDA import failed: {err}")
            if not args.skip_tfda:
                log("=== Taiwan FDA ingredients ===")
                try:
                    report["taiwan_fda"] = import_taiwan_fda(db)
                except Exception as err:  # noqa: BLE001
                    report["taiwan_fda"] = {"error": str(err)}
                    log(f"TFDA import failed: {err}")
            if not args.skip_off:
                log("=== Open Food Facts ingredients (images + packaged foods) ===")
                report["open_food_facts"] = import_open_food_facts(db, args.ingredients)
        log("=== System package recipes ===")
        try:
            report["system_recipes"] = import_system_package_recipes(db)
        except Exception as err:  # noqa: BLE001
            report["system_recipes"] = {"error": str(err)}
            log(f"System package recipes failed: {err}")
        if not args.skip_howtocook:
            log("=== HowToCook recipes ===")
            try:
                report["howtocook"] = import_howtocook(db, cache)
            except Exception as err:  # noqa: BLE001
                report["howtocook"] = {"error": str(err)}
                log(f"HowToCook import failed: {err}")
        if not args.skip_wikibooks:
            log("=== Wikibooks recipes ===")
            try:
                report["wikibooks"] = import_wikibooks(db, args.recipes)
            except Exception as err:  # noqa: BLE001
                report["wikibooks"] = {"error": str(err)}
                log(f"Wikibooks import failed: {err}")
        current_recipes = db.execute("SELECT COUNT(*) FROM recipes WHERE IFNULL(deleted_at,'')=''").fetchone()[0]
        if current_recipes < args.recipes:
            log("=== RecipeNLG open research recipes ===")
            try:
                report["recipe_nlg"] = import_recipe_nlg(db, args.recipes)
            except Exception as err:  # noqa: BLE001
                report["recipe_nlg"] = {"error": str(err)}
                log(f"RecipeNLG import failed: {err}")
        if not args.skip_kitchenware:
            log("=== Concept kitchenware baseline ===")
            report["concept_kitchenware"] = import_concept_kitchenware(db)
            log("=== Wikidata kitchenware ===")
            try:
                report["wikidata_kitchenware"] = import_wikidata_kitchenware(db, args.kitchenware)
            except Exception as err:  # noqa: BLE001
                report["wikidata_kitchenware"] = {"error": str(err)}
                log(f"Wikidata kitchenware failed: {err}")
            log("=== Open Products Facts kitchenware ===")
            report["open_products_facts"] = import_open_products_kitchenware(db, args.kitchenware)
        report["after"] = counts(db)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        after = report["after"]
        if after["ingredients_library"] < 10000 or after["recipes"] < 10000 or after["kitchenware_catalog"] < 10000:
            log(
                "NOTE: one or more catalogues are still under 10k after this pass; "
                "re-run to continue paging public APIs, or widen sources."
            )
            return 2
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
