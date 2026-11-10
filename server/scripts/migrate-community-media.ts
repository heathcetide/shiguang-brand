import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { databaseDriver } from "../src/composition/runtime.js";
import { uploadImageDataUrl } from "../src/services/mediaStorage.js";

export type PostRow = { id: number; user_id: number; image_url: string | null; image_urls: unknown };
export type CommentRow = { id: number; user_id: number; image_url: string | null };

type MediaMigrationStore = {
  posts(): Promise<PostRow[]>;
  comments(): Promise<CommentRow[]>;
  updatePost(id: number, urls: string[]): Promise<void>;
  updateComment(id: number, url: string): Promise<void>;
  close(): Promise<void>;
};

function postgresStore(): MediaMigrationStore {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required when DATABASE_DRIVER=postgresql");
  const pool = new Pool({ connectionString, max: 2 });
  return {
    async posts() {
      return (await pool.query<PostRow>(`SELECT id,user_id,image_url,image_urls FROM community_posts
        WHERE image_url LIKE 'data:%' OR image_urls::text LIKE '%data:image/%' ORDER BY id`)).rows;
    },
    async comments() {
      return (await pool.query<CommentRow>(`SELECT id,user_id,image_url FROM community_comments
        WHERE image_url LIKE 'data:%' ORDER BY id`)).rows;
    },
    async updatePost(id, urls) {
      await pool.query("UPDATE community_posts SET image_url=$1,image_urls=$2::jsonb WHERE id=$3", [
        urls[0] || null,
        urls.length ? JSON.stringify(urls) : null,
        id,
      ]);
    },
    async updateComment(id, url) {
      await pool.query("UPDATE community_comments SET image_url=$1 WHERE id=$2", [url, id]);
    },
    close: () => pool.end(),
  };
}

async function sqliteStore(): Promise<MediaMigrationStore> {
  const { db, initDatabase } = await import("../src/storage/db.js");
  initDatabase();
  return {
    async posts() {
      return db.prepare(`SELECT id,user_id,image_url,image_urls FROM community_posts
        WHERE image_url LIKE 'data:%' OR image_urls LIKE '%data:image/%' ORDER BY id`).all() as PostRow[];
    },
    async comments() {
      return db.prepare(`SELECT id,user_id,image_url FROM community_comments
        WHERE image_url LIKE 'data:%' ORDER BY id`).all() as CommentRow[];
    },
    async updatePost(id, urls) {
      db.prepare("UPDATE community_posts SET image_url=?,image_urls=? WHERE id=?")
        .run(urls[0] || null, urls.length ? JSON.stringify(urls) : null, id);
    },
    async updateComment(id, url) {
      db.prepare("UPDATE community_comments SET image_url=? WHERE id=?").run(url, id);
    },
    async close() { db.close(); },
  };
}

export function deterministicMediaKey(dataUrl: string) {
  return createHash("sha256").update(dataUrl).digest("hex");
}

export function collectPostUrls(post: PostRow) {
  try {
    const parsed: unknown = typeof post.image_urls === "string" ? JSON.parse(post.image_urls) : post.image_urls;
    const urls = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    if (urls.length) return urls;
  } catch {}
  return post.image_url ? [post.image_url] : [];
}

export function isInlineImage(value: string | null): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

async function migrateUrl(url: string, userId: number) {
  if (!isInlineImage(url)) return url;
  return (await uploadImageDataUrl(url, userId, "community", {
    deterministicKey: deterministicMediaKey(url),
    overwrite: true,
  })).url;
}

export async function runMediaMigration(store: MediaMigrationStore, apply: boolean) {
  const [posts, comments] = await Promise.all([store.posts(), store.comments()]);
  const inlineImages = posts.reduce((count, post) => count + collectPostUrls(post).filter(isInlineImage).length, 0)
    + comments.filter((comment) => isInlineImage(comment.image_url)).length;
  if (!apply) return { apply: false, posts: posts.length, comments: comments.length, inlineImages };

  let migrated = 0;
  for (const post of posts) {
    const original = collectPostUrls(post);
    const urls: string[] = [];
    for (const url of original) {
      urls.push(await migrateUrl(url, post.user_id));
      if (isInlineImage(url)) migrated += 1;
    }
    await store.updatePost(post.id, urls);
  }
  for (const comment of comments) {
    if (!isInlineImage(comment.image_url)) continue;
    await store.updateComment(comment.id, await migrateUrl(comment.image_url, comment.user_id));
    migrated += 1;
  }
  return { apply: true, posts: posts.length, comments: comments.length, migrated };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const driver = databaseDriver();
  const store = driver === "postgresql" ? postgresStore() : await sqliteStore();
  try {
    const result = await runMediaMigration(store, apply);
    console.log(JSON.stringify({ driver, ...result, ...(!apply ? {
      next: "rerun with --apply after verifying the staging bucket and database backup",
    } : {}) }, null, 2));
  } finally {
    await store.close();
  }
}

const isEntryPoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isEntryPoint) await main();
