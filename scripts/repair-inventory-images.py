#!/usr/bin/env python3
"""Remap inventory_items placeholder CDN images onto real recipe photos."""
from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data" / "dietdigidose.db")
PLACEHOLDER = re.compile(
    r"/catalog/(?:recipes|ingredients_library)/(\d+)-[a-f0-9]+",
    re.I,
)


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"missing db: {DB}")
    conn = sqlite3.connect(DB)
    images = [
        r[0]
        for r in conn.execute(
            """
            SELECT DISTINCT COALESCE(NULLIF(image_url,''), NULLIF(cover_image_url,''))
            FROM recipes
            WHERE COALESCE(image_url, cover_image_url, '') LIKE '%/catalog/recipes/real-%'
            ORDER BY id
            """
        ).fetchall()
        if r[0]
    ]
    if not images:
        raise SystemExit("no real recipe images available")

    rows = conn.execute("SELECT id, image_url FROM inventory_items").fetchall()
    updated = 0
    for iid, image_url in rows:
        if not image_url:
            continue
        if "/real-" in image_url:
            continue
        if "cdn.lingecho.com" not in image_url and "/catalog/" not in image_url:
            continue
        if PLACEHOLDER.search(image_url) or ("/catalog/recipes/" in image_url and "/real-" not in image_url):
            conn.execute(
                "UPDATE inventory_items SET image_url=? WHERE id=?",
                (images[iid % len(images)], iid),
            )
            updated += 1
    conn.commit()
    print(f"inventory_updated={updated} pool={len(images)}")
    conn.close()


if __name__ == "__main__":
    main()
