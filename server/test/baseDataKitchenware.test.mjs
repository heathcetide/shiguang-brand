import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { repairBaseDataKitchenware } from '../scripts/base-data-kitchenware.mjs';
import { importConcept } from '../scripts/import-concept-runtime.mjs';
import { importRelease, loadRelease, validateRelease } from '../scripts/import-nutrition-enrichment.mjs';
import { importSystem, loadSystemPackage } from '../scripts/import-system-data.mjs';

async function createConceptTables(db) {
    await db.query(`CREATE TEMP TABLE base_data_runtime_ids(collection text,logical_id text,target_table text,target_id text,
        imported_version text,imported_at timestamptz DEFAULT now(),PRIMARY KEY(collection,logical_id));
      CREATE TEMP TABLE ingredients_library(id serial PRIMARY KEY,name text,normalized_name text,category text,
        aliases_json jsonb,search_keywords text,source text,source_version text,quality_status text,nutrition_status text,
        nutrition_basis text,preparation_state text,calories_100g numeric,protein_100g numeric,carbs_100g numeric,fat_100g numeric,
        micronutrients_json jsonb,data_license text,review_notes text,base_data_payload jsonb);
      CREATE TEMP TABLE ingredient_aliases(ingredient_id integer,alias text,normalized_alias text,locale text,alias_type text,
        UNIQUE(ingredient_id,normalized_alias));
      CREATE TEMP TABLE kitchenware_catalog(id serial PRIMARY KEY,name text UNIQUE,category text,aliases jsonb,source text,
        quality_status text,base_data_payload jsonb,attributes_json jsonb);
      CREATE TEMP TABLE recipes(id serial PRIMARY KEY,title text,description text,cook_time numeric,difficulty text,category text,
        calories numeric,protein numeric,carbs numeric,fat numeric,nutrition_json jsonb,nutrition_basis text,ingredients_json jsonb,
        steps_json jsonb,tags jsonb,source text,external_id text,source_url text,source_revision text,data_license text,
        source_attribution text,status text,quality_status text,quality_issues_json jsonb,serving_size numeric,
        automatic_inventory_write_allowed boolean,required_kitchenware_json jsonb,optional_kitchenware_json jsonb,base_data_payload jsonb,deleted_at timestamptz);
      CREATE TEMP TABLE recipe_kitchenware_requirements(recipe_id integer,catalog_id integer,role text,source text,confidence numeric,notes text);`);
}

function enrichmentFixture(version = 'concept-enrichment-2026-10-03.1') {
  const archive = fileURLToPath(new URL('../../datasets/releases/system-data-2026-09-15.2.zip', import.meta.url));
  const files = JSON.parse(execFileSync('python3', ['-c',
    'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n.split("/",1)[1]:json.loads(z.read(n)) for n in z.namelist() if n.endswith(".json")}))', archive],
  {maxBuffer:64 * 1024 * 1024}));
  const legacy = Object.fromEntries(Object.entries({summary:'summary',profiles:'nutrition-profiles',recipes:'recipe-nutrition',inputs:'recipe-inputs',contracts:'recipe-weighing-contracts',equipment:'equipment-role-updates'})
    .map(([key,file]) => [key,files[`data/nutrition/${file}.json`]]));
  const supplement = fileURLToPath(new URL(`../../datasets/releases/${version}.zip`, import.meta.url));
  const folder = mkdtempSync(join(tmpdir(),'dietdigidose-enrichment-test-'));
  try {
    execFileSync('python3',['-c',`import sys,zipfile,pathlib
with zipfile.ZipFile(sys.argv[1]) as archive:
 for name in archive.namelist():
  assert name.startswith(sys.argv[3]+'/')
  relative=name.split('/',1)[1]
  assert '/' not in relative and '\\\\' not in relative and '..' not in relative
  pathlib.Path(sys.argv[2],relative).write_bytes(archive.read(name))`,supplement,folder,version]);
    const manifestRaw = readFileSync(join(folder,'manifest.json'));
    const manifest = JSON.parse(manifestRaw);
    assert.deepEqual(readdirSync(folder).sort(),[...Object.keys(manifest),'manifest.json'].sort());
    for (const [name,checksum] of Object.entries(manifest)) {
      assert.equal(createHash('sha256').update(readFileSync(join(folder,name))).digest('hex'),checksum,name);
    }
    const additionsChecksum = createHash('sha256').update(manifestRaw).digest('hex');
    assert.throws(() => loadRelease(folder,'0'.repeat(64)),/Manifest checksum mismatch/);
    const additions = loadRelease(folder,additionsChecksum);
    assert.deepEqual(additions.profiles.slice(0,31),legacy.profiles);
    for (const key of ['recipes','inputs','contracts','equipment']) assert.deepEqual(additions[key],legacy[key]);
    const baseline = files['data/runtime-input.json'];
    const system = {manifest:files['manifest.json'],baseline,nutrition:legacy,community:files['data/community.json']};
    return {baseline,legacy,additions,additionsChecksum,system,checksum:files['manifest.json'].files['data/nutrition/manifest.json']};
  } finally {
    rmSync(folder,{recursive:true,force:true});
  }
}

async function createSystemTables(db) {
  await createConceptTables(db);
  const schema = readFileSync(new URL('../drizzle/0000_spotty_rocket_racer.sql',import.meta.url),'utf8');
  for (const table of ['users','community_posts','community_comments']) {
    const ddl = schema.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`))[0];
    await db.query(ddl.replace('CREATE TABLE','CREATE TEMP TABLE'));
  }
  await db.query(`CREATE TEMP TABLE system_data_package_imports(version text PRIMARY KEY,manifest_sha256 text NOT NULL,imported_at timestamptz DEFAULT now());
    CREATE TEMP TABLE platform_content_imports(logical_id text PRIMARY KEY,version text NOT NULL,content_sha256 text NOT NULL,
      post_id integer NOT NULL REFERENCES community_posts(id),answer_id integer REFERENCES community_comments(id),activated_at timestamptz NOT NULL,imported_at timestamptz DEFAULT now());
    INSERT INTO users(id,username,password_hash,role) VALUES(1,'package_test_admin','test-only-invalid-password','admin');`);
  // Keep the importers' CREATE TABLE IF NOT EXISTS statements inside this session's temporary schema.
  await db.query('SET search_path=pg_temp');
}

async function tableDigests(db, tables = ['base_data_runtime_ids','ingredients_library','ingredient_aliases','kitchenware_catalog','recipes','recipe_kitchenware_requirements']) {
  const hashes = {};
  for (const table of tables) {
    const rows = (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  return hashes;
}

test('base data kitchenware repairs legacy rows atomically and preserves reviewed mappings', {
  skip: !process.env.TEST_BASE_DATA_DATABASE_URL,
}, async () => {
  const db = new pg.Client({ connectionString: process.env.TEST_BASE_DATA_DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    // Temporary tables isolate the test from any persistent database contents.
    await db.query(`CREATE TEMP TABLE recipes(id integer PRIMARY KEY,source text,external_id text,source_revision text,required_kitchenware_json jsonb);
      CREATE TEMP TABLE recipe_kitchenware_requirements(recipe_id integer,catalog_id integer,role text,source text,confidence float,notes text,
        CHECK(catalog_id>0));`);
    const required = [{ catalog_id: 10,name: '蒸锅' },{ catalog_id: 20,name: '菜刀' }];
    const legacy = required.map(({ catalog_id }) => ({ catalog_id }));
    for (let id=1;id<=4;id++) await db.query(`INSERT INTO recipes VALUES($1,'base_data',$2,'rc7',$3::jsonb)`,[id,`recipe-${id}`,JSON.stringify(legacy)]);
    assert.equal(await repairBaseDataKitchenware(db,1,'recipe-1','rc7',required),true);
    assert.deepEqual((await db.query('SELECT required_kitchenware_json FROM recipes WHERE id=1')).rows[0].required_kitchenware_json,required);
    assert.deepEqual((await db.query('SELECT catalog_id,role,notes FROM recipe_kitchenware_requirements ORDER BY catalog_id')).rows,
      required.map(item => ({ catalog_id: item.catalog_id,role: 'required',notes: item.name })));
    assert.equal(await repairBaseDataKitchenware(db,1,'recipe-1','rc7',required),false);
    await db.query(`UPDATE recipes SET required_kitchenware_json='[{"name":"管理员修改"}]' WHERE id=2`);
    assert.equal(await repairBaseDataKitchenware(db,2,'recipe-2','rc7',required),false);
    await db.query(`INSERT INTO recipe_kitchenware_requirements VALUES(3,30,'required','admin',1,'已审核')`);
    assert.equal(await repairBaseDataKitchenware(db,3,'recipe-3','rc7',required),false);
    assert.equal(await repairBaseDataKitchenware(db,4,'wrong-logical-id','rc7',required),false);
    assert.equal((await db.query('SELECT count(*) FROM recipe_kitchenware_requirements')).rows[0].count,'3');
    await db.query('SAVEPOINT failed_repair');
    const invalid = [{ catalog_id: 10,name: '蒸锅' },{ catalog_id: -1,name: '无效' }];
    await db.query('UPDATE recipes SET required_kitchenware_json=$1::jsonb WHERE id=4',[JSON.stringify(invalid.map(({catalog_id}) => ({catalog_id})))]);
    await assert.rejects(repairBaseDataKitchenware(db,4,'recipe-4','rc7',invalid));
    await db.query('ROLLBACK TO SAVEPOINT failed_repair');
    assert.equal((await db.query('SELECT count(*) FROM recipe_kitchenware_requirements WHERE recipe_id=4')).rows[0].count,'0');
    assert.deepEqual((await db.query('SELECT required_kitchenware_json FROM recipes WHERE id=4')).rows[0].required_kitchenware_json,legacy);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});

test('concept replay preserves nutrition, administrator edits and related rows; rejects changed identities', {
  skip: !process.env.TEST_BASE_DATA_DATABASE_URL,
}, async () => {
  const archive = fileURLToPath(new URL('../../datasets/releases/system-data-2026-09-15.2.zip', import.meta.url));
  const data = JSON.parse(execFileSync('python3', ['-c',
    'import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read("system-data-2026-09-15.2/data/runtime-input.json"))', archive],
  {maxBuffer:64 * 1024 * 1024}));
  const db = new pg.Client({connectionString:process.env.TEST_BASE_DATA_DATABASE_URL});
  await db.connect();
  try {
    // Only session-local tables are used, including when CI shares a PostgreSQL service.
    await createConceptTables(db);
    const ingredient = data['ingredient-forms'].find(f => data.concepts.some(c => c.id === f.concept_id && c.active_catalogue &&
      (c.kind === 'ingredient' || c.application_roles?.includes('ingredient'))));
    const tool = data.baseline.kitchenware[0], method = data.methods[0];
    await db.query(`INSERT INTO ingredients_library(id,name,source,source_version,base_data_payload)
      VALUES(10000,'legacy ingredient','base_data','0.1.0-rc.7',$1)`,[JSON.stringify({id:ingredient.legacy_ingredient_id})]);
    await db.query(`INSERT INTO kitchenware_catalog(id,name,source,base_data_payload)
      VALUES(10000,$1,'base_data',$2)`,[tool.name,JSON.stringify({id:tool.id})]);
    await db.query(`INSERT INTO recipes(id,source,source_revision,external_id,base_data_payload)
      VALUES(10000,'base_data','0.1.0-rc.7',$1,$2)`,[method.source_method_id,JSON.stringify({id:method.source_method_id})]);
    for (const [collection,logical,table] of [['ingredients',ingredient.legacy_ingredient_id,'ingredients_library'],
      ['kitchenware',tool.id,'kitchenware_catalog'],['recipes',method.source_method_id,'recipes']]) {
      await db.query(`INSERT INTO base_data_runtime_ids(collection,logical_id,target_table,target_id,imported_version)
        VALUES($1,$2,$3,'10000','0.1.0-rc.7')`,[collection,logical,table]);
    }
    const first = await importConcept(db,data,{apply:true});
    assert.equal(first.inserted,1726);
    assert.equal(first.reused,3);
    for (const table of ['ingredients_library','kitchenware_catalog','recipes']) {
      assert.equal((await db.query(`SELECT source FROM ${table} WHERE id=10000`)).rows[0].source,'concept_base');
    }
    await db.query(`UPDATE ingredients_library SET name='管理员编辑食材',calories_100g=123,
        base_data_payload=base_data_payload || '{"nutrition_references":[{"source":"reviewed"}]}' WHERE id=10000;
      DELETE FROM ingredient_aliases WHERE ingredient_id=10000;
      INSERT INTO ingredient_aliases VALUES(10000,'管理员别名','管理员别名','zh','admin');
      UPDATE kitchenware_catalog SET aliases='["管理员厨具别名"]',attributes_json='{"capacity":3}' WHERE id=10000;
      UPDATE recipes SET title='管理员编辑菜谱',description='经补充的营养说明',calories=321,protein=42,nutrition_basis='ingredient_estimate',
        base_data_payload=base_data_payload || '{"nutrition_enrichment":{"version":"enriched"},"variants":["reviewed"],"equipment_references":["reviewed"]}' WHERE id=10000;
      DELETE FROM recipe_kitchenware_requirements WHERE recipe_id=10000;
      INSERT INTO recipe_kitchenware_requirements VALUES(10000,10000,'optional','admin',1,'管理员审核');`);
    const snapshot = async () => {
      const hashes = {};
      for (const table of ['base_data_runtime_ids','ingredients_library','ingredient_aliases','kitchenware_catalog','recipes','recipe_kitchenware_requirements']) {
        const rows = (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
        hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      }
      return hashes;
    };
    const before = await snapshot();
    const replay = await importConcept(db,data,{apply:true});
    assert.equal(replay.inserted,0);
    assert.equal(replay.reused,1729);
    assert.deepEqual(await snapshot(),before);
    for (const [change,restore,reason] of [
      ["UPDATE ingredients_library SET source='manual' WHERE id=10000","UPDATE ingredients_library SET source='concept_base' WHERE id=10000",/non-imported/],
      ["UPDATE recipes SET external_id='changed' WHERE id=10000",'UPDATE recipes SET external_id=base_data_payload->>\'method_id\' WHERE id=10000',/identity or version/],
      ["UPDATE kitchenware_catalog SET base_data_payload=jsonb_set(base_data_payload,'{version}','\"changed\"') WHERE id=10000",
        "UPDATE kitchenware_catalog SET base_data_payload=jsonb_set(base_data_payload,'{version}','\"concept-base-1.0.0-rc.2\"') WHERE id=10000",/identity or version/],
      ["UPDATE base_data_runtime_ids SET imported_version='changed' WHERE collection='concept_methods' AND target_id='10000'",
        "UPDATE base_data_runtime_ids SET imported_version='concept-base-1.0.0-rc.2' WHERE collection='concept_methods' AND target_id='10000'",/Runtime mapping changed/],
      ["UPDATE base_data_runtime_ids SET target_id='invalid' WHERE collection='concept_methods' AND target_id='10000'",
        "UPDATE base_data_runtime_ids SET target_id='10000' WHERE collection='concept_methods' AND target_id='invalid'",/Runtime mapping changed/],
    ]) {
      await db.query(change);
      const changed = await snapshot();
      await assert.rejects(importConcept(db,data,{apply:true}),reason);
      assert.deepEqual(await snapshot(),changed);
      await db.query(restore);
    }
    assert.deepEqual(await snapshot(),before);
  } finally {
    await db.end();
  }
});

test('nutrition releases validate the known additions mode and exact summary counts', () => {
  const {legacy,additions} = enrichmentFixture();
  validateRelease(legacy);
  validateRelease(additions);
  for (const change of [data => { data.summary.scoped_profiles--; },data => { delete data.summary.import_mode; },
    data => { data.summary.version = 'unknown'; },data => { data.profiles.push(data.profiles[0]); }]) {
    const bad = structuredClone(additions);
    change(bad);
    assert.throws(() => validateRelease(bad));
  }
});

test('system package rejects missing mandatory checksums and malformed manifests before consuming payloads', () => {
  const archive = fileURLToPath(new URL('../../datasets/releases/system-data-2026-09-15.2.zip',import.meta.url));
  const folder = mkdtempSync(join(tmpdir(),'dietdigidose-system-integrity-'));
  try {
    execFileSync('python3',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,folder]);
    const packagePath = join(folder,'system-data-2026-09-15.2');
    const manifestPath = join(packagePath,'manifest.json');
    const original = JSON.parse(readFileSync(manifestPath));
    assert.equal(loadSystemPackage(packagePath).baseline.methods.length,389);
    for (const path of ['data/runtime-input.json','data/community.json','data/nutrition/manifest.json']) {
      const incomplete = structuredClone(original);
      delete incomplete.files[path];
      writeFileSync(manifestPath,JSON.stringify(incomplete));
      assert.throws(() => loadSystemPackage(packagePath),/Missing required package member/);
    }
    for (const invalid of [null,[],{}, {...original,files:null}, {...original,files:[]}, {...original,files:'invalid'}]) {
      writeFileSync(manifestPath,JSON.stringify(invalid));
      assert.throws(() => loadSystemPackage(packagePath),/Invalid package manifest/);
    }
    for (const checksum of [null,123,{},'a'.repeat(63),'g'.repeat(64),'A'.repeat(64)]) {
      const invalid = structuredClone(original);
      invalid.files['data/community.json'] = checksum;
      writeFileSync(manifestPath,JSON.stringify(invalid));
      assert.throws(() => loadSystemPackage(packagePath),/Invalid package checksum/);
    }
    writeFileSync(manifestPath,JSON.stringify(original));
    const communityPath = join(packagePath,'data/community.json');
    writeFileSync(communityPath,readFileSync(communityPath,'utf8') + '\n');
    assert.throws(() => loadSystemPackage(packagePath),/Package checksum mismatch: data\/community.json/);
  } finally {
    rmSync(folder,{recursive:true,force:true});
  }
});

test('system importer CLI reads an explicit package directory before checking the database connection', () => {
  const archive = fileURLToPath(new URL('../../datasets/releases/system-data-2026-09-15.2.zip',import.meta.url));
  const script = fileURLToPath(new URL('../scripts/import-system-data.mjs',import.meta.url));
  const folder = mkdtempSync(join(tmpdir(),'dietdigidose-system-cli-'));
  try {
    execFileSync('python3',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,folder]);
    const packagePath = join(folder,'system-data-2026-09-15.2');
    for (const flags of [[],['--apply']]) {
      assert.throws(() => execFileSync(process.execPath,[script,packagePath,...flags],{env:{...process.env,DATABASE_URL:''},stdio:'pipe'}),
        error => /Set DATABASE_URL/.test(error.stderr.toString()));
    }
    assert.throws(() => execFileSync(process.execPath,[script,join(folder,'missing-package')],{env:{...process.env,DATABASE_URL:''},stdio:'pipe'}),
      error => /missing-package.*manifest\.json/.test(error.stderr.toString()));
  } finally {
    rmSync(folder,{recursive:true,force:true});
  }
});

for (const installLegacy of [false,true]) test(`scoped references preserve edits, replay without writes and block conflicts (${installLegacy ? 'upgrade' : 'fresh catalogue'})`, {
  skip: !process.env.TEST_BASE_DATA_DATABASE_URL,
}, async () => {
  const {baseline,legacy,additions,checksum,additionsChecksum} = enrichmentFixture();
  const db = new pg.Client({connectionString:process.env.TEST_BASE_DATA_DATABASE_URL});
  await db.connect();
  try {
    await createConceptTables(db);
    await importConcept(db,baseline,{apply:true});
    const recipeId = Number((await db.query("SELECT target_id FROM base_data_runtime_ids WHERE collection='concept_methods' AND logical_id=$1",[legacy.recipes[0].method_id])).rows[0].target_id);
    const originalRecipe = (await db.query('SELECT * FROM recipes WHERE id=$1',[recipeId])).rows[0];
    if (installLegacy) {
      // A late recipe failure must roll back the ingredient references written earlier in the transaction.
      for (const [field,value] of [['serving_size',99],['description','管理员说明'],['protein',99]]) {
        await db.query(`UPDATE recipes SET ${field}=$1 WHERE id=$2`,[value,recipeId]);
        const edited = await tableDigests(db);
        await assert.rejects(importRelease(db,legacy,checksum,true),/Recipe.*edited since snapshot/);
        assert.deepEqual(await tableDigests(db),edited);
        await db.query(`UPDATE recipes SET ${field}=$1 WHERE id=$2`,[originalRecipe[field],recipeId]);
      }
      const imported = await importRelease(db,legacy,checksum,true);
      assert.equal(imported.recipes_updated,20);
      assert.equal(imported.references_added,31);
      // The historical importer did not stamp ingredient manifest hashes; adopt these rows without resetting them.
      await db.query("UPDATE ingredients_library SET base_data_payload=base_data_payload - 'enrichment_manifest_sha256' WHERE base_data_payload ? 'enrichment_version'");
      const adopted = await importRelease(db,legacy,checksum,true);
      assert.equal(adopted.references_added,0);
      assert.equal(adopted.recipes_updated,0);
    }
    const conceptId = legacy.profiles[0].ingredient_concept_id;
    const manual = {id:'MANUAL:reviewed-sample',scope:'管理员新增的独立参考'};
    await db.query(`UPDATE ingredients_library SET name='管理员编辑食材',calories_100g=123,
      base_data_payload=jsonb_set(base_data_payload,'{nutrition_references}',COALESCE(base_data_payload->'nutrition_references','[]'::jsonb) || $1::jsonb)
      WHERE base_data_payload->>'concept_id'=$2`,[JSON.stringify([manual]),conceptId]);
    await db.query(`UPDATE recipes SET description='管理员修改营养说明',serving_size=99,calories=321,
      base_data_payload=base_data_payload || '{"equipment_references":["管理员审核"]}' WHERE id=$1`,[recipeId]);
    await db.query(`DELETE FROM recipe_kitchenware_requirements WHERE recipe_id=$1`,[recipeId]);
    const unchangedTables = ['recipes','recipe_kitchenware_requirements','ingredient_aliases','kitchenware_catalog','base_data_runtime_ids'];
    const beforeRecipes = await tableDigests(db,unchangedTables);
    if (installLegacy) {
      const replayWrites = [];
      const observed = {query:(sql,values) => { if (/^\s*(UPDATE|INSERT|DELETE)\b/.test(sql)) replayWrites.push(sql); return db.query(sql,values); }};
      const replay = await importRelease(observed,legacy,checksum,true);
      assert.equal(replay.recipes_unchanged,20);
      assert.equal(replay.ingredient_concepts_updated,0);
      assert.deepEqual(replayWrites,[]);
    }
    const before = await tableDigests(db);
    const wrongForm = structuredClone(additions);
    wrongForm.profiles.at(-1).ingredient_form_id = 'FORM:missing';
    await assert.rejects(importRelease(db,wrongForm,additionsChecksum,true),/Ingredient form changed/);
    assert.deepEqual(await tableDigests(db),before);
    const wrongConcept = structuredClone(additions);
    wrongConcept.profiles.at(-1).ingredient_concept_id = 'CONCEPT:missing';
    await assert.rejects(importRelease(db,wrongConcept,additionsChecksum,true),/Missing or changed mapping/);
    assert.deepEqual(await tableDigests(db),before);
    // First prove that a full dry run rolls back; then apply exactly the same content.
    await importRelease(db,additions,additionsChecksum,false);
    assert.deepEqual(await tableDigests(db),before);
    const imported = await importRelease(db,additions,additionsChecksum,true);
    assert.equal(imported.references_added,installLegacy ? 15 : 46);
    assert.equal(imported.recipes_updated,0);
    assert.equal(imported.recipes_unchanged,0);
    assert.equal(imported.recipes_skipped,20);
    assert.equal(imported.requirements_added,0);
    assert.deepEqual(await tableDigests(db,unchangedTables),beforeRecipes);
    const payload = (await db.query("SELECT base_data_payload FROM ingredients_library WHERE base_data_payload->>'concept_id'=$1",[conceptId])).rows[0].base_data_payload;
    assert.deepEqual(payload.nutrition_references.find(p => p.id === manual.id),manual);
    const applied = await tableDigests(db);
    const replayWrites = [];
    const observed = {query:(sql,values) => { if (/^\s*(UPDATE|INSERT|DELETE)\b/.test(sql)) replayWrites.push(sql); return db.query(sql,values); }};
    const replay = await importRelease(observed,additions,additionsChecksum,true);
    assert.equal(replay.ingredient_concepts_updated,0);
    assert.equal(replay.references_added,0);
    assert.deepEqual(replayWrites,[]);
    assert.deepEqual(await tableDigests(db),applied);
    await assert.rejects(importRelease(db,additions,'0'.repeat(64),true),/Immutable version mismatch/);
    await assert.rejects(importRelease(db,legacy,checksum,true),/downgrade/);
    assert.deepEqual(await tableDigests(db),applied);
    const last = additions.profiles.at(-1);
    const lastId = Number((await db.query("SELECT target_id FROM base_data_runtime_ids WHERE collection='concept_ingredients' AND logical_id=$1",[last.ingredient_concept_id])).rows[0].target_id);
    const lastPayload = (await db.query('SELECT base_data_payload FROM ingredients_library WHERE id=$1',[lastId])).rows[0].base_data_payload;
    for (const references of [lastPayload.nutrition_references.filter(p => p.id !== last.id),
      lastPayload.nutrition_references.map(p => p.id === last.id ? {...p,scope:'管理员修改了此样品'} : p)]) {
      await db.query("UPDATE ingredients_library SET base_data_payload=jsonb_set(base_data_payload,'{nutrition_references}',$1) WHERE id=$2",[JSON.stringify(references),lastId]);
      const edited = await tableDigests(db);
      await assert.rejects(importRelease(db,additions,additionsChecksum,true),/removed|edited or conflicting/);
      assert.deepEqual(await tableDigests(db),edited);
      await db.query('UPDATE ingredients_library SET base_data_payload=$1 WHERE id=$2',[JSON.stringify(lastPayload),lastId]);
    }
  } finally {
    await db.end();
  }
});

for (const version of ['concept-enrichment-2026-10-02.1','concept-enrichment-2026-10-03.1']) {
  for (const referenceFirst of [false,true]) test(`complete system and ${version} install safely (${referenceFirst ? 'references first' : 'system first'})`, {
    skip: !process.env.TEST_BASE_DATA_DATABASE_URL,
  }, async () => {
    const {baseline,legacy,additions,additionsChecksum,system,checksum} = enrichmentFixture(version);
    const db = new pg.Client({connectionString:process.env.TEST_BASE_DATA_DATABASE_URL});
    await db.connect();
    try {
      await createSystemTables(db);
      const tables = ['ingredients_library','recipes','recipe_kitchenware_requirements','community_posts','community_comments','system_data_package_imports','platform_content_imports'];
      if (referenceFirst) await importConcept(db,baseline,{apply:true});
      else await importSystem(db,system,{apply:true,authorId:1});
      await importRelease(db,additions,additionsChecksum,true);
      const references = await tableDigests(db,['ingredients_library']);
      if (referenceFirst) {
        const profile = legacy.profiles.at(-1);
        const ingredient = (await db.query("SELECT id,base_data_payload FROM ingredients_library WHERE base_data_payload->>'concept_id'=$1",[profile.ingredient_concept_id])).rows[0];
        for (const mutate of [
          payload => { payload.nutrition_references = payload.nutrition_references.filter(p => p.id !== profile.id); },
          payload => { payload.nutrition_references.find(p => p.id === profile.id).scope = '管理员修改的范围'; },
          payload => { payload.enrichment_version = 'unknown-reference-version'; },
        ]) {
          const edited = structuredClone(ingredient.base_data_payload);
          mutate(edited);
          await db.query('UPDATE ingredients_library SET base_data_payload=$1 WHERE id=$2',[JSON.stringify(edited),ingredient.id]);
          const before = await tableDigests(db,tables);
          await assert.rejects(importSystem(db,system,{apply:true,authorId:1}),/missing a required baseline sample|edited or conflicting|unknown version/);
          assert.deepEqual(await tableDigests(db,tables),before);
          await db.query('UPDATE ingredients_library SET base_data_payload=$1 WHERE id=$2',[JSON.stringify(ingredient.base_data_payload),ingredient.id]);
        }
        // Fail on the final recipe after earlier recipe updates, then prove the outer system transaction rolled them all back.
        const lastRecipe = (await db.query('SELECT id,description FROM recipes WHERE external_id=$1',[legacy.recipes.at(-1).method_id])).rows[0];
        await db.query("UPDATE recipes SET description='管理员修改最后一道菜' WHERE id=$1",[lastRecipe.id]);
        const before = await tableDigests(db,tables);
        await assert.rejects(importSystem(db,system,{apply:true,authorId:1}),/Recipe nutrition edited since snapshot/);
        assert.deepEqual(await tableDigests(db,tables),before);
        await db.query('UPDATE recipes SET description=$1 WHERE id=$2',[lastRecipe.description,lastRecipe.id]);
        const dryRun = await tableDigests(db,tables);
        await importSystem(db,system,{apply:false,authorId:1});
        assert.deepEqual(await tableDigests(db,tables),dryRun);
        await importSystem(db,system,{apply:true,authorId:1});
      }
      assert.deepEqual(await tableDigests(db,['ingredients_library']),references);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM recipes WHERE calories IS NOT NULL')).rows[0].count,8);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM community_posts')).rows[0].count,19);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM community_comments')).rows[0].count,12);
      const complete = await tableDigests(db,tables);
      await assert.rejects(importRelease(db,legacy,checksum,true),/downgrade/);
      assert.equal((await importSystem(db,system,{apply:true,authorId:1})).already_imported,true);
      assert.deepEqual(await tableDigests(db,tables),complete);
    } finally {
      await db.end();
    }
  });
}
