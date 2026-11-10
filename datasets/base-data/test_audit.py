import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("base_audit", Path(__file__).with_name("audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_positive_rejects_unknown_boolean_negative_and_nonfinite(self):
        for value in [None, True, False, "3", -1, 0, float("nan"), float("inf")]:
            self.assertFalse(audit.positive(value))
        self.assertTrue(audit.positive(0.5))

    def test_archive_and_source_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            source = b'{}'
            member = b'[]'
            manifest = {"files": [
                {"path": "sources.lock.json", "bytes": len(source), "sha256": audit.digest(source)},
                {"path": "clean/recipes.json", "bytes": len(member), "sha256": audit.digest(member)},
            ]}
            path = Path(folder) / "fixture.zip"
            with zipfile.ZipFile(path, "w") as z:
                z.writestr("manifest.json", json.dumps(manifest))
                z.writestr("sources.lock.json", source)
                z.writestr("clean/recipes.json", member)
            lock = {"sha256": audit.digest(path.read_bytes()), "sources_lock_sha256": audit.digest(source)}
            self.assertEqual(audit.verified_files(path, lock, source)["clean/recipes.json"], member)
            with self.assertRaisesRegex(ValueError, "Source lock"):
                audit.verified_files(path, lock, b'{"tampered":true}')
            path.write_bytes(path.read_bytes() + b'changed')
            with self.assertRaisesRegex(ValueError, "Archive SHA"):
                audit.verified_files(path, lock, source)

    def test_all_rows_get_dispositions_without_promoting_unknown_evidence(self):
        ingredient = {"id": "i0", "name": "番茄", "aliases": [], "nutrition": None}
        recipe = {"id": "r0", "title": "番茄菜", "servings": None, "nutrition": None,
                  "ingredients": [{"name": "苹果", "ingredient_id": "i0", "quantity": -1, "unit": "g"}],
                  "steps": ["烹饪"], "kitchenware_ids": ["missing"]}
        collections = {"ingredients": [dict(ingredient, id=f"i{i}") for i in range(447)],
                       "kitchenware": [{"id": f"k{i}", "name": f"设备{i}"} for i in range(241)],
                       "recipes": [dict(recipe, id=f"r{i}") for i in range(341)]}
        before = copy.deepcopy(collections)
        result = audit.audit({f"clean/{key}.json": audit.encoded(rows) for key, rows in collections.items()})
        self.assertEqual(collections, before)
        self.assertEqual({key: len(rows) for key, rows in result.items()},
                         {"ingredients": 447, "kitchenware": 241, "recipes": 341})
        first = result["recipes"][0]
        self.assertFalse(first["automatic_execution_allowed"])
        self.assertIsNone(first["evidence"]["nutrition"])
        self.assertEqual(len(first["evidence"]["possible_duplicates"]), 340)
        for gap in ["servings_missing", "ingredient_0_mapping_name_needs_review",
                    "ingredient_0_structured_amount_missing", "kitchenware_mapping_missing"]:
            self.assertIn(gap, first["missing_or_unverified"])


if __name__ == "__main__":
    unittest.main()
