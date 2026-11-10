import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export function validateCommunity(data) {
  const count = {'community-content-2026-09-15.1':16,'community-content-2026-09-15.2':19}[data.version];
  if (!count || data.posts.length !== count || new Set(data.posts.map(p => p.id)).size !== count) throw new Error('Unexpected community package');
  if (data.posts.filter(p => p.category === '活动').length !== 4 || data.posts.filter(p => p.category === '问答').length !== 12) throw new Error('Unexpected categories');
  if (data.posts.filter(p => p.category === '榜单').length !== count - 16) throw new Error('Unexpected ranking count');
  for (const p of data.posts) {
    if (!p.id.startsWith('PLATFORM:') || !p.content.includes('平台') || p.content.length > 5000) throw new Error('Missing editorial attribution');
    if (p.category === '活动' && (!Number.isInteger(p.start_offset_days) || p.start_offset_days < 0 || !Number.isInteger(p.duration_days) || p.duration_days <= 0)) throw new Error('Invalid activity schedule');
    if (p.category === '问答' && !p.answer?.startsWith('【平台参考答复】')) throw new Error('Missing editorial answer');
  }
}

export async function importCommunity(db, data, {apply = false, authorId, activation = new Date().toISOString()} = {}) {
  validateCommunity(data);
  const anchor = new Date(activation).getTime();
  if (!Number.isFinite(anchor)) throw new Error('Invalid activation date');
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(187,8)');
    await db.query(`CREATE TABLE IF NOT EXISTS platform_content_imports(
      logical_id text PRIMARY KEY, version text NOT NULL, content_sha256 text NOT NULL,
      post_id integer NOT NULL REFERENCES community_posts(id), answer_id integer REFERENCES community_comments(id),
      activated_at timestamptz NOT NULL, imported_at timestamptz NOT NULL DEFAULT now())`);
    const authors = (await db.query("SELECT id,username,avatar_url FROM users WHERE role='admin' AND is_disabled=FALSE AND ($1::int IS NULL OR id=$1)", [authorId || null])).rows;
    if (authors.length !== 1) throw new Error('Set COMMUNITY_AUTHOR_ID to one existing active administrator');
    const author = authors[0], counts = {posts_created: 0, answers_created: 0, unchanged: 0};
    for (const p of data.posts) {
      const digest = createHash('sha256').update(JSON.stringify(p)).digest('hex');
      const old = (await db.query('SELECT * FROM platform_content_imports WHERE logical_id=$1', [p.id])).rows[0];
      if (old) {
        if (old.content_sha256 !== digest) throw new Error('Existing content differs; explicit new-version review required');
        counts.unchanged++;
        continue;
      }
      let recipeId = null;
      if (p.linked_method_id) {
        const recipe = (await db.query(`SELECT r.id FROM base_data_runtime_ids m JOIN recipes r ON r.id=m.target_id::int
          WHERE m.collection='concept_methods' AND m.logical_id=$1 AND r.deleted_at IS NULL AND r.status='approved' AND r.quality_status<>'needs_review'`, [p.linked_method_id])).rows[0];
        if (!recipe) throw new Error('Missing public recipe: ' + p.linked_method_id);
        recipeId = recipe.id;
      }
      const start = p.category === '活动' ? new Date(anchor + p.start_offset_days * 86400000).toISOString() : null;
      const end = start ? new Date(new Date(start).getTime() + p.duration_days * 86400000).toISOString() : null;
      const post = (await db.query(`INSERT INTO community_posts(user_id,username,avatar_url,category,content,image_urls,
        event_start_at,event_end_at,question_status,linked_recipe_id,likes_count,views_count,comment_count)
        VALUES($1,$2,$3,$4,$5,'[]',$6,$7,$8,$9,0,0,0) RETURNING id`,
        [author.id,author.username,author.avatar_url,p.category,p.content,start,end,p.category === '问答' ? 'open' : null,recipeId])).rows[0];
      let answerId = null;
      if (p.answer) {
        answerId = (await db.query(`INSERT INTO community_comments(post_id,user_id,username,avatar_url,content,likes_count)
          VALUES($1,$2,$3,$4,$5,0) RETURNING id`, [post.id,author.id,author.username,author.avatar_url,p.answer])).rows[0].id;
        await db.query('UPDATE community_posts SET comment_count=1 WHERE id=$1', [post.id]);
        counts.answers_created++;
      }
      await db.query('INSERT INTO platform_content_imports(logical_id,version,content_sha256,post_id,answer_id,activated_at) VALUES($1,$2,$3,$4,$5,$6)',
        [p.id,data.version,digest,post.id,answerId,activation]);
      counts.posts_created++;
    }
    await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    return {mode: apply ? 'committed' : 'dry_run_rolled_back', version: data.version, ...counts};
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const raw = readFileSync(process.argv[2]);
  if (createHash('sha256').update(raw).digest('hex') !== process.env.COMMUNITY_INPUT_SHA256) throw new Error('Community checksum mismatch');
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
  const db = await pool.connect();
  try { console.log(JSON.stringify(await importCommunity(db, JSON.parse(raw), {apply: process.argv.includes('--apply'), authorId: Number(process.env.COMMUNITY_AUTHOR_ID) || undefined}))); }
  finally { db.release(); await pool.end(); }
}
