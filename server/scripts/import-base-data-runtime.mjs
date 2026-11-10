// PostgreSQL rc.7 business import. Defaults to a rollback dry run; --apply commits.
// Run from the deployed server with DATABASE_URL and DDD_DEMO_PASSWORD_1/2/3.
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { repairBaseDataKitchenware } from './base-data-kitchenware.mjs';

const version = '0.1.0-rc.7';
const checksum = '57f20c858bac5823985f0fc402dc1e432c8a61c8e7984eaa46f443d2d6813ab8';
const apply = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
const counts = {};
let repairedRecipeKitchenware = 0;
try {
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'");
  await db.query('SELECT pg_advisory_xact_lock(187, 8)');
  const release = (await db.query('SELECT * FROM base_data.releases WHERE version=$1', [version])).rows[0];
  if (release?.archive_sha256 !== checksum) throw new Error('Missing or conflicting verified archive');
  const files = (await db.query('SELECT path,content,sha256 FROM base_data.files WHERE version=$1', [version])).rows;
  if (files.length !== 39 || files.some(f => createHash('sha256').update(f.content).digest('hex') !== f.sha256)) {
    throw new Error('Archive file integrity failure');
  }
  const read = name => JSON.parse(files.find(f => f.path === `clean/${name}.json`).content.toString());
  const ingredients = read('ingredients'), recipes = read('recipes'), kitchenware = read('kitchenware'), initial = read('initial-data');
  if (ingredients.length !== 447 || recipes.length !== 341 || kitchenware.length !== 241 || initial.posts.length !== 100) throw new Error('Unexpected counts');
  if (!(await db.query("SELECT to_regclass('public.base_data_runtime_ids') AS name")).rows[0]?.name) {
    throw new Error('Apply the formal base_data_runtime_schema migration before importing; importer never changes schema');
  }
  const mapping = new Map();
  for (const r of (await db.query('SELECT * FROM public.base_data_runtime_ids')).rows) mapping.set(`${r.collection}:${r.logical_id}`, r.target_id);
  const id = (collection, logical) => {
    const found = mapping.get(`${collection}:${logical}`);
    if (!found) throw new Error(`Missing mapping ${collection}:${logical}`);
    return Number(found);
  };
  async function map(collection, logical, table, target) {
    await db.query('INSERT INTO public.base_data_runtime_ids(collection,logical_id,target_table,target_id,imported_version) VALUES($1,$2,$3,$4,$5)', [collection, logical, table, String(target), version]);
    mapping.set(`${collection}:${logical}`, String(target));
    counts[collection] = (counts[collection] || 0) + 1;
  }
  async function insert(table, row) {
    const fields = Object.keys(row);
    const result = await db.query(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(row));
    return result.rows[0];
  }
  const encoded = JSON.stringify;
  for (const r of initial.accounts) {
    if (mapping.has(`accounts:${r.id}`)) continue;
    const existing = (await db.query('SELECT id,role FROM users WHERE username=$1', [r.username])).rows[0];
    if (existing) {
      if (r.role !== 'admin' || existing.role !== 'admin') throw new Error(`Existing username collision: ${r.username}; no changes applied`);
      await map('accounts', r.id, 'users', existing.id);
      continue;
    }
    const password = process.env[r.password_env];
    if (!password || password.length < 16) throw new Error(`Provide a strong password through ${r.password_env}`);
    if (Buffer.byteLength(password, "utf8") > 72) throw new Error(`${r.password_env} must not exceed 72 UTF-8 bytes`);
    const created = await insert('users', { username: r.username, nickname: r.nickname, role: r.role,
      email: r.is_demo ? `${r.username}@demo.dietdigidose.invalid` : null,
      password_hash: await bcrypt.hash(password, 12), must_change_password: true, is_demo: r.is_demo });
    await map('accounts', r.id, 'users', created.id);
  }
  for (const r of ingredients) {
    if (mapping.has(`ingredients:${r.id}`)) continue;
    if (r.nutrition !== null) throw new Error('Unexpected nutrition contract');
    const created = await insert('ingredients_library', { name: r.name, category: r.category,
      calories_100g: null, nutrition_status: 'unknown', normalized_name: r.name.normalize('NFKC').toLowerCase(),
      aliases_json: encoded(r.aliases), search_keywords: [r.name, ...r.aliases].join(' '),
      preparation_state: r.state || 'unspecified', quality_status: 'needs_review', nutrition_basis: 'unknown',
      source: 'base_data', source_version: version, data_license: r.source_license,
      review_notes: '候选目录；营养未知；名称、状态及别名待审核。', base_data_payload: encoded(r) });
    await map('ingredients', r.id, 'ingredients_library', created.id);
  }
  for (const r of kitchenware) {
    if (mapping.has(`kitchenware:${r.id}`)) continue;
    if ((await db.query('SELECT 1 FROM kitchenware_catalog WHERE name=$1', [r.name])).rowCount) throw new Error(`Kitchenware name collision: ${r.name}`);
    const created = await insert('kitchenware_catalog', { name: r.name, category: r.category,
      aliases: encoded(r.aliases), source: 'base_data', quality_status: 'needs_review',
      cooking_methods: '[]', attributes_json: encoded({ automatic_substitution_allowed: false, source_url: r.source_url, source_release: r.source_release }),
      base_data_payload: encoded(r) });
    await map('kitchenware', r.id, 'kitchenware_catalog', created.id);
  }
  for (const r of recipes) {
    const requiredKitchenware = [...new Set(r.kitchenware_ids)].map(k => {
      const entry = kitchenware.find(item => item.id === k);
      if (!entry) throw new Error(`Unknown kitchenware ${k}`);
      return { catalog_id: id('kitchenware', k), name: entry.name };
    });
    if (mapping.has(`recipes:${r.id}`)) {
      if (await repairBaseDataKitchenware(db, id('recipes', r.id), r.id, version, requiredKitchenware)) {
        repairedRecipeKitchenware += 1;
      }
      continue;
    }
    if (r.automatic_inventory_write_allowed !== false) throw new Error('Unexpected recipe capability');
    const mappedIngredients = r.ingredients.map(i => ({ ...i, source_ingredient_id: i.ingredient_id,
      ingredient_id: i.ingredient_id == null ? null : id('ingredients', i.ingredient_id), amount: i.amount_text }));
    const created = await insert('recipes', { title: r.title, description: '候选菜谱，供阅读和审核；营养及烹饪内容尚未核验。',
      cook_time: r.estimated_minutes ?? null, calories: null, protein: null, carbs: null, fat: null,
      steps_json: encoded(r.steps), ingredients_json: encoded(mappedIngredients), tags: '[]',
      source: 'base_data', external_id: r.id, source_url: r.source_url, source_revision: version,
      data_license: r.source_license, status: 'pending', quality_status: 'needs_review', nutrition_basis: 'unknown',
      quality_issues_json: encoded(['nutrition_unknown', 'cooking_not_reviewed']), serving_size: r.servings ?? null,
      required_kitchenware_json: encoded(requiredKitchenware.map(item => ({ catalog_id: item.catalog_id }))),
      automatic_inventory_write_allowed: false, base_data_payload: encoded(r) });
    await map('recipes', r.id, 'recipes', created.id);
    await repairBaseDataKitchenware(db, created.id, r.id, version, requiredKitchenware);
  }
  for (const r of initial.posts) {
    if (mapping.has(`posts:${r.id}`)) continue;
    const user = (await db.query('SELECT * FROM users WHERE id=$1', [id('accounts', r.author_id)])).rows[0];
    const created = await insert('community_posts', { user_id: user.id, username: user.username, nickname: user.nickname,
      content: r.content, category: r.category, linked_recipe_id: r.recipe_id == null ? null : id('recipes', r.recipe_id),
      likes_count: 0, views_count: 0, is_demo: true });
    await map('posts', r.id, 'community_posts', created.id);
  }
  for (const r of initial.comments) {
    if (mapping.has(`comments:${r.id}`)) continue;
    const user = (await db.query('SELECT * FROM users WHERE id=$1', [id('accounts', r.author_id)])).rows[0];
    const postId = id('posts', r.post_id);
    const created = await insert('community_comments', { post_id: postId, user_id: user.id, username: user.username,
      nickname: user.nickname, content: r.content, is_demo: true });
    await db.query('UPDATE community_posts SET comment_count=COALESCE(comment_count,0)+1 WHERE id=$1', [postId]);
    await map('comments', r.id, 'community_comments', created.id);
  }
  for (const r of initial.inventory) {
    if (mapping.has(`inventory:${r.id}`)) continue;
    const ingredient = ingredients.find(i => i.id === r.ingredient_id);
    const date = (await db.query("SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date+$1::integer,'YYYY-MM-DD') AS date", [r.expires_in_days])).rows[0].date;
    const created = await insert('inventory_items', { user_id: id('accounts', r.owner_id), food_name: ingredient.name,
      category: ingredient.category || '其他', quantity: `${r.quantity}${r.unit}`, quantity_value: r.quantity,
      quantity_unit: r.unit, expiration_date: date, storage_location: r.storage_location, is_demo: true });
    await map('inventory', r.id, 'inventory_items', created.id);
  }
  for (const r of initial.favorites) {
    if (mapping.has(`favorites:${r.id}`)) continue;
    const userId = id('accounts', r.owner_id), recipeId = id('recipes', r.recipe_id);
    await insert('recipe_favorites', { user_id: userId, recipe_id: recipeId, is_demo: true });
    await map('favorites', r.id, 'recipe_favorites', `${userId}:${recipeId}`);
  }
  const total = Number((await db.query('SELECT count(*) FROM public.base_data_runtime_ids WHERE imported_version=$1', [version])).rows[0].count);
  if (total !== 1151) throw new Error(`Mapping count mismatch: ${total}`);
  await db.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ mode: apply ? 'committed' : 'dry_run_rolled_back', version, newMappings: counts, repairedRecipeKitchenware, totalMappings: total }));
} catch (error) {
  await db.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}
