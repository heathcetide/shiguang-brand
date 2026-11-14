#!/usr/bin/env python3
"""Point community posts at real catalog recipe photos and preset avatars.

migrate-media left tiny placeholder JPEGs under community_posts_* CDN keys and
uploaded Dicebear SVGs as .jpg. Remap to known-good /real- recipe images and
preset-avatar:N so client/admin show real food photos and local avatars.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data" / "dietdigidose.db")
PRESET_COUNT = 7


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"missing db: {DB}")
    conn = sqlite3.connect(DB)
    images = [
        r[0]
        for r in conn.execute(
            """
            SELECT DISTINCT image_url FROM recipes
            WHERE image_url LIKE '%/catalog/recipes/real-%'
            ORDER BY id
            """
        ).fetchall()
        if r[0]
    ]
    if not images:
        raise SystemExit("no real recipe images found; run catalog image backfill first")

    posts = conn.execute(
        "SELECT id, image_url, avatar_url, user_id FROM community_posts"
    ).fetchall()
    img_updated = 0
    av_updated = 0
    for pid, image_url, avatar_url, user_id in posts:
        new_image = image_url
        if image_url and (
            "community_posts_image_url" in image_url
            or "/catalog/recipes/" in image_url and "/real-" not in image_url
        ):
            new_image = images[pid % len(images)]
            img_updated += 1
        elif not image_url:
            # leave text-only posts without forcing an image
            new_image = image_url

        new_avatar = avatar_url
        if not avatar_url or "community_posts_avatar_url" in avatar_url or "dicebear" in avatar_url:
            new_avatar = f"preset-avatar:{(user_id or pid) % PRESET_COUNT}"
            av_updated += 1

        if new_image != image_url or new_avatar != avatar_url:
            conn.execute(
                "UPDATE community_posts SET image_url=?, avatar_url=? WHERE id=?",
                (new_image, new_avatar, pid),
            )

    user_rows = conn.execute("SELECT id, avatar_url FROM users").fetchall()
    users_updated = 0
    for uid, avatar_url in user_rows:
        if not avatar_url or "community_posts_avatar_url" in avatar_url or "dicebear" in avatar_url:
            conn.execute(
                "UPDATE users SET avatar_url=? WHERE id=?",
                (f"preset-avatar:{uid % PRESET_COUNT}", uid),
            )
            users_updated += 1

    conn.commit()
    print(
        f"posts={len(posts)} image_remapped={img_updated} avatar_remapped={av_updated} "
        f"users_avatar={users_updated} pool={len(images)}"
    )
    sample = conn.execute(
        "SELECT id, substr(image_url,1,90), avatar_url FROM community_posts WHERE image_url IS NOT NULL AND image_url!='' ORDER BY id DESC LIMIT 5"
    ).fetchall()
    for row in sample:
        print("sample", row)
    conn.close()


if __name__ == "__main__":
    main()
