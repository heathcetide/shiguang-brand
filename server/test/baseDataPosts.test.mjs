import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Execute the actual CLI body with an in-memory database double. No archive,
// credentials, PostgreSQL connection, or persistent data is used by these tests.
const source = readFileSync(new URL('../scripts/import-base-data-runtime.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '');
const checksum = '57f20c858bac5823985f0fc402dc1e432c8a61c8e7984eaa46f443d2d6813ab8';

async function runImport(recipeFields, { existingPost = false } = {}) {
  const mappings = [];
  const collection = (name, count) => Array.from({ length: count }, (_, i) => {
    const id = `${name}-${i}`;
    mappings.push({ collection: name, logical_id: id, target_id: String(i + 1) });
    return { id, kitchenware_ids: [] };
  });
  const ingredients = collection('ingredients', 447);
  const kitchenware = collection('kitchenware', 241);
  const recipes = collection('recipes', 341);
  const posts = collection('posts', 100);
  if (!existingPost) mappings.splice(mappings.findIndex(row => row.collection === 'posts'), 1);
  posts[0] = { id: 'posts-0', author_id: 'accounts-0', content: '今天的厨房日常', category: '动态', ...recipeFields };
  const initial = { accounts: collection('accounts', 1), posts, comments: [], inventory: [], favorites: [] };
  const files = Object.entries({ ingredients, kitchenware, recipes, 'initial-data': initial }).map(([name, value]) => {
    const content = Buffer.from(JSON.stringify(value));
    return { path: `clean/${name}.json`, content, sha256: createHash('sha256').update(content).digest('hex') };
  });
  while (files.length < 39) files.push({ path: `fixture-${files.length}`, content: Buffer.alloc(0), sha256: createHash('sha256').digest('hex') });
  const statements = [], insertedPosts = [], errors = [];
  let released = false, ended = false;
  const db = {
    async query(sql, values) {
      statements.push(sql);
      if (sql.startsWith('SELECT * FROM base_data.releases')) return { rows: [{ archive_sha256: checksum }] };
      if (sql.startsWith('SELECT path,content,sha256')) return { rows: files };
      if (sql.startsWith('SELECT to_regclass')) return { rows: [{ name: 'base_data_runtime_ids' }] };
      if (sql === 'SELECT * FROM public.base_data_runtime_ids') return { rows: mappings };
      if (sql.startsWith('SELECT * FROM users')) return { rows: [{ id: 1, username: 'fixture', nickname: '测试' }] };
      if (sql.startsWith('INSERT INTO community_posts')) {
        const columns = sql.match(/\(([^)]+)\)/)[1].split(',');
        insertedPosts.push(Object.fromEntries(columns.map((column, i) => [column, values[i]])));
        return { rows: [{ id: 1001 }] };
      }
      if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: '1151' }] };
      if (sql.startsWith('INSERT INTO public.base_data_runtime_ids') || ['BEGIN', 'ROLLBACK'].includes(sql)
        || sql.startsWith('SET LOCAL') || sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
    release() { released = true; },
  };
  const process = { argv: [], env: {} };
  await vm.runInNewContext(`(async () => {\n${source}\n})()`, {
    pg: { Pool: class { async connect() { return db; } async end() { ended = true; } } },
    createHash, repairBaseDataKitchenware: async () => false, process,
    console: { log() {}, error(message) { errors.push(message); } },
  });
  assert.equal(released, true);
  assert.equal(ended, true);
  assert.equal(statements.at(-1), 'ROLLBACK');
  return { insertedPosts, errors, exitCode: process.exitCode };
}

for (const [label, fields] of [['omitted', {}], ['null', { recipe_id: null }]]) {
  test(`base importer accepts a post with ${label} recipe reference`, async () => {
    const result = await runImport(fields);
    assert.deepEqual(result.errors, []);
    assert.equal(result.exitCode, undefined);
    assert.equal(result.insertedPosts.length, 1);
    assert.equal(result.insertedPosts[0].linked_recipe_id, null);
    assert.equal(result.insertedPosts[0].content, '今天的厨房日常');
  });
}

test('base importer resolves an explicit recipe reference', async () => {
  const result = await runImport({ recipe_id: 'recipes-7' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.insertedPosts[0].linked_recipe_id, 8);
});

for (const value of ['missing-recipe', '', 0, false, 'null', 'undefined', {}, []]) {
  test(`base importer rejects explicit invalid recipe reference ${JSON.stringify(value)}`, async () => {
    const result = await runImport({ recipe_id: value });
    assert.equal(result.exitCode, 1);
    assert.match(result.errors[0], /^Missing mapping recipes:/);
    assert.deepEqual(result.insertedPosts, []);
  });
}

test('base importer leaves an already mapped post unchanged', async () => {
  const result = await runImport({}, { existingPost: true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.insertedPosts, []);
});
