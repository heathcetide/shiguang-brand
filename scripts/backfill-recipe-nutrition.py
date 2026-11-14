#!/usr/bin/env python3
"""Estimate missing recipe macros from ingredients_library matches.

Writes calories/protein/carbs/fat and marks quality_status=estimated when
at least one ingredient matched with grams. Unknown recipes stay NULL.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data" / "dietdigidose.db")

GRAM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|g|克|兩|两|斤)", re.I)
ALIAS = {
    "肉": ["猪肉", "猪里脊", "五花肉"],
    "鲜面条": ["挂面", "面条", "鲜面条"],
    "面条": ["挂面", "面条"],
    "豆角": ["豇豆", "四季豆", "豆角"],
    "盐": ["食盐", "盐"],
    "油": ["食用油", "花生油", "菜籽油"],
    "酱油": ["生抽", "老抽", "酱油"],
    "蒜": ["大蒜", "蒜"],
    "姜": ["生姜", "姜"],
    "葱": ["大葱", "葱"],
    "鸡蛋": ["鸡蛋", "蛋"],
    "米饭": ["米饭", "大米"],
    "豆腐": ["豆腐"],
}


def to_grams(amount: str) -> float | None:
    if not amount:
        return None
    text = amount.replace("。", "").strip()
    m = GRAM_RE.search(text)
    if not m:
        # bare number like "2" without unit → skip
        return None
    n = float(m.group(1))
    unit = m.group(2).lower()
    if unit in ("kg", "斤"):
        return n * 500 if unit == "斤" else n * 1000
    if unit in ("兩", "两"):
        return n * 50
    return n


def load_foods(conn: sqlite3.Connection) -> list[tuple[str, float, float, float, float]]:
    rows = conn.execute(
        """
        SELECT name, COALESCE(calories_100g,0), COALESCE(protein_100g,0),
               COALESCE(carbs_100g,0), COALESCE(fat_100g,0)
        FROM ingredients_library
        WHERE COALESCE(calories_100g,0) > 0 AND deleted_at IS NULL
        """
    ).fetchall()
    return [(str(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4])) for r in rows]


def match_food(name: str, foods: list[tuple[str, float, float, float, float]]):
    needle = re.sub(r"\s+", "", name or "").strip("。，, ")
    if not needle:
        return None
    candidates = [needle] + ALIAS.get(needle, [])
    # Prefer shorter exact-ish library names containing the candidate.
    best = None
    best_score = 10**9
    for food_name, cal, pro, carb, fat in foods:
        fn = re.sub(r"\s+", "", food_name)
        for cand in candidates:
            if cand == fn:
                return cal, pro, carb, fat
            if cand in fn or fn in cand:
                score = abs(len(fn) - len(cand))
                if score < best_score:
                    best_score = score
                    best = (cal, pro, carb, fat)
    return best


def estimate(ingredients: list[dict], foods) -> tuple[float, float, float, float, int] | None:
    total = [0.0, 0.0, 0.0, 0.0]
    matched = 0
    for item in ingredients:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        grams = to_grams(str(item.get("amount") or ""))
        if grams is None or grams <= 0:
            # default portion when Chinese recipes omit grams on seasoning
            if any(k in name for k in ("盐", "酱油", "油", "糖", "醋", "料酒")):
                grams = 5.0
            else:
                continue
        macros = match_food(name, foods)
        if not macros:
            continue
        matched += 1
        factor = grams / 100.0
        for i in range(4):
            total[i] += macros[i] * factor
    if matched == 0:
        return None
    # Per-serving estimate: assume 2 servings for home cooking when servings unknown.
    servings = 2.0
    return total[0] / servings, total[1] / servings, total[2] / servings, total[3] / servings, matched


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"missing db: {DB}")
    conn = sqlite3.connect(DB)
    foods = load_foods(conn)
    rows = conn.execute(
        """
        SELECT id, ingredients_json FROM recipes
        WHERE (calories IS NULL OR calories <= 0)
          AND ingredients_json IS NOT NULL AND length(ingredients_json) > 2
        """
    ).fetchall()
    updated = 0
    for rid, raw in rows:
        try:
            ingredients = json.loads(raw or "[]")
        except json.JSONDecodeError:
            continue
        if not isinstance(ingredients, list):
            continue
        est = estimate(ingredients, foods)
        if not est:
            continue
        cal, pro, carb, fat, matched = est
        conn.execute(
            """
            UPDATE recipes
            SET calories=?, protein=?, carbs=?, fat=?,
                quality_status=CASE
                  WHEN quality_status IS NULL OR quality_status='' OR quality_status='needs_review'
                  THEN 'estimated' ELSE quality_status END
            WHERE id=?
            """,
            (round(cal, 1), round(pro, 1), round(carb, 1), round(fat, 1), rid),
        )
        updated += 1
    conn.commit()
    with_cal = conn.execute("SELECT COUNT(*) FROM recipes WHERE calories > 0").fetchone()[0]
    print(f"updated={updated} recipes_with_calories={with_cal}")
    sample = conn.execute(
        "SELECT id, title, calories, protein, carbs, fat FROM recipes WHERE title LIKE '%豆角焖面%' LIMIT 3"
    ).fetchall()
    for row in sample:
        print("sample", row)
    conn.close()


if __name__ == "__main__":
    main()
