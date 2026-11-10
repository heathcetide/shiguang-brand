// Explicit business projection. Default: rollback; --apply commits. No user/demo writes.
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function importConcept(db, data, { apply = false, checksum = null } = {}) {
const version = data.version;
if (version !== 'concept-base-1.0.0-rc.2' || data.methods.length !== 389 || data.concepts.length !== 3566) throw new Error('Unexpected release');
const json = JSON.stringify;
const normalize = s => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const toolCategory = name => ({'餐具与食物容器':'刀具餐具','刀具与手动工具':'刀具餐具','锅具与烘焙器具':'烹饪锅具','料理与饮品电器':'小家电','烹饪电器':'小家电','制冷与清洗电器':'小家电','厨卫电器':'小家电'}[name] || '其他');
const recipeCategory = name => ({meat_dish:'荤菜',vegetable_dish:'素菜',staple:'主食',aquatic:'水产',breakfast:'早餐',soup:'汤羹',drink:'饮品',project_draft:'家常菜',dessert:'甜品', 'semi-finished':'半成品',condiment:'调味'}[name] || '其他');
const counts = { ingredients: 0, kitchenware: 0, methods: 0, primaryRecipes: 0, reused: 0, inserted: 0 };
const preserved = new Set();
try {
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'");
  await db.query('SELECT pg_advisory_xact_lock(187,8)');
  const existing = new Map((await db.query('SELECT * FROM base_data_runtime_ids')).rows.map(r => [`${r.collection}:${r.logical_id}`, r]));
  const tables = {ingredients:'ingredients_library',concept_ingredients:'ingredients_library',kitchenware:'kitchenware_catalog',concept_kitchenware:'kitchenware_catalog',recipes:'recipes',concept_methods:'recipes'};
  const get = (collection, id) => {
    const row = existing.get(`${collection}:${id}`);
    if (!row) return undefined;
    const target = Number(row.target_id);
    if (!Number.isSafeInteger(target) || target <= 0 || row.target_table !== tables[collection] || row.imported_version !== (collection.startsWith('concept_') ? version : '0.1.0-rc.7')) {
      throw new Error(`Runtime mapping changed: ${collection}:${id}`);
    }
    return target;
  };
  async function mapping(collection, logical, table, id) {
    await db.query(`INSERT INTO base_data_runtime_ids(collection,logical_id,target_table,target_id,imported_version)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(collection,logical_id) DO UPDATE SET
      target_id=excluded.target_id,imported_version=excluded.imported_version,imported_at=now()`, [collection,logical,table,String(id),version]);
    existing.set(`${collection}:${logical}`, {target_id:id,target_table:table,imported_version:version});
  }
  async function save(table, row, id, legacyIds) {
    const keys = Object.keys(row), values = Object.values(row);
    if (id) {
      const old = (await db.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!old || !['base_data','concept_base'].includes(old.source)) throw new Error(`Refusing to overwrite non-imported ${table}:${id}`);
      if (old.source === 'concept_base') {
        const expected = JSON.parse(row.base_data_payload), actual = old.base_data_payload;
        const collection = {ingredients_library:'concept_ingredients',kitchenware_catalog:'concept_kitchenware',recipes:'concept_methods'}[table];
        if (actual?.version !== version || actual.concept_id !== expected.concept_id ||
            get(collection, expected.method_id || expected.concept_id) !== id ||
            (table === 'ingredients_library' && old.source_version !== version) ||
            (table === 'recipes' && (old.source_revision !== version || old.external_id !== row.external_id || actual.method_id !== expected.method_id))) {
          throw new Error(`Concept identity or version changed: ${table}:${id}`);
        }
        // Replaying this fixed release must preserve enrichment and later administrator edits.
        preserved.add(`${table}:${id}`);
        counts.reused++;
        return id;
      }
      if (!legacyIds.includes(old.base_data_payload?.id) ||
          (table === 'ingredients_library' && old.source_version !== '0.1.0-rc.7') ||
          (table === 'recipes' && (old.source_revision !== '0.1.0-rc.7' || old.external_id !== old.base_data_payload.id))) {
        throw new Error(`Legacy identity or version changed: ${table}:${id}`);
      }
      await db.query(`UPDATE ${table} SET ${keys.map((k,i) => `${k}=$${i+1}`).join(',')} WHERE id=$${keys.length+1}`, [...values,id]);
      counts.reused++;
      return id;
    }
    counts.inserted++;
    return (await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i) => `$${i+1}`).join(',')}) RETURNING id`,values)).rows[0].id;
  }
  const concepts = new Map(data.concepts.map(c => [c.id,c]));
  const aliases = new Map();
  for (const a of data.aliases) if (a.status !== 'unreviewed_not_indexed') aliases.set(a.concept_id,[...(aliases.get(a.concept_id)||[]),a]);
  const forms = new Map();
  for (const f of data['ingredient-forms']) forms.set(f.concept_id,[...(forms.get(f.concept_id)||[]),f]);
  const ingredientIds = new Map(), toolIds = new Map(), methodIds = new Map();
  const ingredientSource = new Map(data.baseline.ingredients.map(i => [i.id,i]));
  for (const c of data.concepts.filter(c => c.active_catalogue && (c.kind === 'ingredient' || c.application_roles?.includes('ingredient')))) {
    const fs = forms.get(c.id)||[], aa = aliases.get(c.id)||[];
    const names = [...new Set([c.name_zh,...aa.map(a=>a.text),...fs.map(f=>f.display_name)])];
    const oldId = get('concept_ingredients',c.id) || fs.map(f=>get('ingredients',f.legacy_ingredient_id)).find(Boolean);
    const source = ingredientSource.get(fs[0]?.legacy_ingredient_id);
    const id = await save('ingredients_library', {
      name:c.name_zh,normalized_name:normalize(c.name_zh),category:source?.category || c.application_categories?.[0]?.value || '其他',
      aliases_json:json(names.filter(n=>n!==c.name_zh)),search_keywords:names.join(' '),source:'concept_base',source_version:version,
      quality_status:'reference',nutrition_status:'unknown',nutrition_basis:'unknown',preparation_state:'unspecified',
      calories_100g:null,protein_100g:null,carbs_100g:null,fat_100g:null,micronutrients_json:null,
      data_license:c.sources.map(s=>s.source_license).filter(Boolean).join('; ') || null,
      review_notes:'概念目录可检索；具体部位、状态与营养记录尚需逐项匹配。',
      base_data_payload:json({concept_id:c.id,version,concept:c,forms:fs,aliases:aa,nutrition_status:'unknown',automatic_calculation_allowed:false}),
    },oldId,fs.map(f=>f.legacy_ingredient_id));
    ingredientIds.set(c.id,id); counts.ingredients++;
    if (preserved.has(`ingredients_library:${id}`)) continue;
    await mapping('concept_ingredients',c.id,'ingredients_library',id);
    for (const name of names) await db.query(`INSERT INTO ingredient_aliases(ingredient_id,alias,normalized_alias,locale,alias_type)
      VALUES($1,$2,$3,$4,'concept') ON CONFLICT(ingredient_id,normalized_alias) DO NOTHING`,
      [id,name,normalize(name),aa.find(a=>a.text===name)?.language || 'zh']);
  }
  for (const r of data.baseline.kitchenware) {
    const link = data['legacy-map'].find(m=>m.legacy_table==='kitchenware' && m.legacy_id===r.id);
    const c = concepts.get(link?.concept_id);
    if (!c?.active_catalogue) throw new Error(`Missing kitchenware concept: ${r.id}`);
    const collision = (await db.query('SELECT id,source FROM kitchenware_catalog WHERE name=$1',[c.name_zh])).rows[0];
    const aa = aliases.get(c.id)||[];
    const id = await save('kitchenware_catalog',{
      name:c.name_zh,category:toolCategory(r.category),aliases:json([...new Set([...r.aliases,...aa.map(a=>a.text)])]),
      source:'concept_base',quality_status:'reference',base_data_payload:json({concept_id:c.id,version,concept:c,aliases:aa,source_record:r}),
      attributes_json:json({automatic_substitution_allowed:false,source_url:r.source_url}),
    },get('concept_kitchenware',c.id)||get('kitchenware',r.id)||collision?.id,[r.id]);
    toolIds.set(c.id,id);counts.kitchenware++;
    if (!preserved.has(`kitchenware_catalog:${id}`)) await mapping('concept_kitchenware',c.id,'kitchenware_catalog',id);
  }
  const recipeSource = new Map(data.baseline.recipes.map(r=>[r.id,r]));
  const recipeConcepts = new Map(data['recipe-concepts'].map(r=>[r.dish_concept_id,r]));
  for (const m of data.methods) {
    const c = concepts.get(m.dish_concept_id), rc = recipeConcepts.get(m.dish_concept_id), r = recipeSource.get(m.source_method_id);
    if (!c?.active_catalogue || !rc || !r || !m.steps.length) throw new Error(`Incomplete recipe: ${m.id}`);
    const primary = rc.primary_method_id===m.id;
    const ingredients = m.ingredients.map(i=>({...i,amount:i.amount_text||'',ingredient_id:ingredientIds.get(i.ingredient_concept_id)||null}));
    const aa = aliases.get(c.id)||[];
    const id = await save('recipes',{
      title:primary?c.name_zh:m.title,description:'做法参考；营养尚未完成原料与用量匹配，暂不计算。',
      cook_time:r.estimated_minutes??null,difficulty:r.difficulty||'未标注',category:recipeCategory(r.category),
      calories:null,protein:null,carbs:null,fat:null,nutrition_json:'[]',nutrition_basis:'unknown',
      ingredients_json:json(ingredients),steps_json:json(m.steps.map(s=>s.text)),
      tags:json([...new Set([m.title,c.name_zh,...aa.map(a=>a.text)])]),
      source:'concept_base',external_id:m.id,source_url:m.source.source_url,source_revision:version,
      data_license:m.source.source_license,source_attribution:m.source.source_url||'项目基础配方',
      status:'approved',quality_status:'reference',quality_issues_json:json(['nutrition_unknown','not_kitchen_tested']),
      serving_size:m.servings??null,automatic_inventory_write_allowed:false,
      required_kitchenware_json:json(m.equipment_requirements.filter(e=>e.role==='required').flatMap(e=>e.concept_ids.map(cid=>({catalog_id:toolIds.get(cid)})))),
      optional_kitchenware_json:json(m.equipment_requirements.filter(e=>e.role==='optional').flatMap(e=>e.concept_ids.map(cid=>({catalog_id:toolIds.get(cid)})))),
      base_data_payload:json({concept_id:c.id,recipe_concept_id:rc.id,method_id:m.id,is_primary:primary,version,
        primary_selection:rc.primary_selection,missing_fields:m.missing_fields,equipment_requirements:m.equipment_requirements,
        nutrition_status:'unknown',nutrition_calculation_basis:'whole_recipe',source:m.source}),
    },get('concept_methods',m.id)||get('recipes',m.source_method_id),[m.source_method_id]);
    methodIds.set(m.id,id);counts.methods++; if(primary)counts.primaryRecipes++;
    if (preserved.has(`recipes:${id}`)) continue;
    await mapping('concept_methods',m.id,'recipes',id);
    // Source references without classified roles remain separate; never assert they are mandatory.
    await db.query("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id=$1 AND source IN ('base_data','concept_base')",[id]);
    for (const e of m.equipment_requirements.filter(e=>['required','optional'].includes(e.role))) {
      for (const cid of e.concept_ids) {
        if (!toolIds.has(cid)) throw new Error(`Unresolved tool ${cid}`);
        await db.query(`INSERT INTO recipe_kitchenware_requirements(recipe_id,catalog_id,role,source,confidence,notes)
          VALUES($1,$2,$3,'concept_base',1,$4)`,[id,toolIds.get(cid),e.role,'来源明确标注的厨具角色']);
      }
    }
  }
  for (const m of data.methods) {
    if (preserved.has(`recipes:${methodIds.get(m.id)}`)) continue;
    const rc=recipeConcepts.get(m.dish_concept_id);
    const variants=rc.method_ids.map(mid=>({recipe_id:methodIds.get(mid),method_id:mid,title:data.methods.find(x=>x.id===mid).title,is_primary:mid===rc.primary_method_id}));
    const equipment=m.equipment_requirements.map(e=>({...e,items:e.concept_ids.map(cid=>({catalog_id:toolIds.get(cid),name:concepts.get(cid)?.name_zh}))}));
    await db.query(`UPDATE recipes SET base_data_payload=base_data_payload || $1::jsonb WHERE id=$2`,
      [json({variants,primary_recipe_id:methodIds.get(rc.primary_method_id),equipment_references:equipment}),methodIds.get(m.id)]);
  }
  if(counts.ingredients!==1079 || counts.kitchenware!==261 || counts.methods!==389 || counts.primaryRecipes!==385) throw new Error(`Unexpected projection ${json(counts)}`);
  await db.query(apply?'COMMIT':'ROLLBACK');
  return {mode:apply?'committed':'dry_run_rolled_back',version,input_sha256:checksum,...counts};
} catch(error) { await db.query('ROLLBACK');throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = readFileSync(process.argv[2]);
  const checksum = createHash('sha256').update(input).digest('hex');
  if (!process.env.CONCEPT_INPUT_SHA256 || checksum !== process.env.CONCEPT_INPUT_SHA256) throw new Error('Input checksum mismatch');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  try { console.log(JSON.stringify(await importConcept(db, JSON.parse(input), {apply:process.argv.includes('--apply'),checksum}))); }
  finally { db.release();await pool.end(); }
}
