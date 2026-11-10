// Additive, versioned import; --apply commits after all source and recipe checks pass.
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const keys = ['calories', 'protein', 'fat', 'carbs'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const equalNumber = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 0.00006;
const json = JSON.stringify;
const legacyVersion = 'concept-enrichment-2026-09-15.2';
const additionsVersions = ['concept-enrichment-2026-10-02.1', 'concept-enrichment-2026-10-03.1'];
const baselineVersion = 'concept-base-1.0.0-rc.2';
const versions = ['concept-enrichment-2026-09-15.1', legacyVersion, ...additionsVersions];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const equal = (a, b) => json(canonical(a)) === json(canonical(b));
export function validateRelease(data) {
  const additions = additionsVersions.includes(data.summary.version) && data.summary.import_mode === 'scoped_reference_additions';
  if ((!additions && (data.summary.version !== legacyVersion || data.summary.import_mode != null)) ||
      data.profiles.length !== (additions ? 46 : 31) || data.recipes.length !== 20 ||
      data.summary.scoped_profiles !== data.profiles.length || data.summary.recipes_assessed !== 20 || data.summary.core_complete_recipes !== 8) {
    throw new Error('Unexpected enrichment release');
  }
  const profiles = new Map(data.profiles.map(p => [p.id, p]));
  if (profiles.size !== data.profiles.length || new Set(data.recipes.map(r => r.method_id)).size !== 20) throw new Error('Duplicate input identity');
  for (const profile of data.profiles) {
    if (!profile.requires_scope_confirmation || profile.automatic_runtime_binding !== false || !profile.scope || !profile.source_url) throw new Error('Unsafe sample scope');
    for (const key of keys) {
      const n = profile.nutrients_per_100g[key];
      if (!n || n.unit !== (key === 'calories' ? 'kcal' : 'g') || !(n.amount === null || finite(n.amount))) throw new Error('Invalid observation');
    }
  }
  for (const recipe of data.recipes) {
    const original = data.inputs.find(m => m.id === recipe.method_id);
    if (!original || original.ingredients.length !== recipe.total_lines || recipe.automatic_meal_planning_allowed !== false || recipe.servings !== original.servings) throw new Error('Invalid recipe contract');
    if (new Set(recipe.selections.map(s => s.line_id)).size !== recipe.selections.length) throw new Error('Duplicate selection');
    const sums = Object.fromEntries(keys.map(k => [k, 0]));
    const coverage = Object.fromEntries(keys.map(k => [k, 0]));
    for (const s of recipe.selections) {
      const line = original.ingredients.find(i => i.line_id === s.line_id), p = profiles.get(s.profile_id);
      if (!line || !p || line.ingredient_form_id !== p.ingredient_form_id || p.scope !== s.scope || !s.scope_is_recipe_assumption || s.weight_basis !== 'pre_cooking_edible_grams' || !finite(s.grams) || s.grams <= 0 || line.measurement?.unit !== 'g' || line.measurement?.kind !== 'exact' || line.measurement.value !== s.grams || line.ingredient_options?.length || ['choice_unresolved','bundle_unresolved'].includes(line.mapping_status)) throw new Error('Unconfirmed recipe selection');
      for (const key of keys) if (p.nutrients_per_100g[key].amount !== null) {
        sums[key] += p.nutrients_per_100g[key].amount * s.grams / 100;
        coverage[key]++;
      }
    }
    const complete = original.ingredients.length > 0 && keys.every(k => coverage[k] === original.ingredients.length);
    if ((recipe.status === 'core_complete_under_declared_assumptions') !== complete) throw new Error('Wrong completeness');
    for (const key of keys) {
      if (recipe.coverage[key] !== coverage[key]) throw new Error('Wrong coverage');
      if (coverage[key] === original.ingredients.length && original.ingredients.length) {
        if (!equalNumber(recipe.whole_recipe[key], sums[key])) throw new Error('Wrong recipe sum');
      } else if (recipe.whole_recipe[key] !== null) throw new Error('Missing nutrient replaced with value');
    }
    if (complete && finite(recipe.servings) && recipe.servings > 0) {
      if (!recipe.per_serving || keys.some(k => !equalNumber(recipe.per_serving[k], sums[k] / recipe.servings))) throw new Error('Wrong serving calculation');
    } else if (recipe.per_serving !== null) throw new Error('Incomplete per-serving values');
  }
  if (data.recipes.filter(r => r.per_serving).length !== 8) throw new Error('Unexpected complete recipe count');
}

export function loadRelease(folder, checksum) {
  const manifestRaw = readFileSync(resolve(folder, 'manifest.json'));
  if (!checksum || hash(manifestRaw) !== checksum) throw new Error('Manifest checksum mismatch');
  const manifest = JSON.parse(manifestRaw);
  const load = name => {
    const raw = readFileSync(resolve(folder, name));
    if (hash(raw) !== manifest[name]) throw new Error(`File checksum mismatch: ${name}`);
    return JSON.parse(raw);
  };
  const data = { summary: load('summary.json'), profiles: load('nutrition-profiles.json'), recipes: load('recipe-nutrition.json'),
    inputs: load('recipe-inputs.json'), contracts: load('recipe-weighing-contracts.json'), equipment: load('equipment-role-updates.json') };
  validateRelease(data);
  return data;
}

export async function importRelease(db, data, checksum, apply, {preserveNewerReferences = false} = {}) {
  validateRelease(data);
  if (!/^[a-f0-9]{64}$/.test(checksum || '')) throw new Error('Missing enrichment manifest checksum');
  const version = data.summary.version;
  const additions = data.summary.import_mode === 'scoped_reference_additions';
  const counts = { recipes_updated: 0, recipes_unchanged: 0, recipes_skipped: 0, ingredient_concepts_updated: 0, ingredient_concepts_unchanged: 0, references_added: 0, requirements_added: 0 };
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'");
    await db.query('SELECT pg_advisory_xact_lock(187,8)');
    const mappings = new Map((await db.query('SELECT * FROM base_data_runtime_ids')).rows.map(r => [`${r.collection}:${r.logical_id}`, r]));
    const get = (collection, logical) => {
      const row = mappings.get(`${collection}:${logical}`), id = Number(row?.target_id);
      const table = {concept_ingredients:'ingredients_library',concept_methods:'recipes',concept_kitchenware:'kitchenware_catalog'}[collection];
      if (!Number.isSafeInteger(id) || id <= 0 || row.target_table !== table || row.imported_version !== baselineVersion) throw new Error(`Missing or changed mapping ${collection}:${logical}`);
      return id;
    };
    const grouped = new Map();
    for (const p of data.profiles) grouped.set(p.ingredient_concept_id, [...(grouped.get(p.ingredient_concept_id) || []), p]);
    for (const [conceptId, profiles] of grouped) {
      const id = get('concept_ingredients', conceptId);
      const row = (await db.query('SELECT source,source_version,base_data_payload FROM ingredients_library WHERE id=$1 FOR UPDATE', [id])).rows[0];
      const payload = row?.base_data_payload;
      if (row?.source !== 'concept_base' || row.source_version !== baselineVersion || payload?.version !== baselineVersion || payload.concept_id !== conceptId) throw new Error('Ingredient identity changed');
      if (!Array.isArray(payload.forms) || profiles.some(p => !payload.forms.some(f => f.id === p.ingredient_form_id && f.concept_id === conceptId))) throw new Error('Ingredient form changed');
      const currentVersion = payload.enrichment_version, currentChecksum = payload.enrichment_manifest_sha256;
      const newer = currentVersion && versions.indexOf(currentVersion) > versions.indexOf(version);
      if (currentVersion && (!versions.includes(currentVersion) || (newer && (!preserveNewerReferences || additions)))) throw new Error('Refusing enrichment downgrade or unknown version');
      if (currentVersion === version && currentChecksum && currentChecksum !== checksum) throw new Error('Immutable version mismatch');
      const current = payload.nutrition_references ?? [];
      if (!Array.isArray(current) || current.some(p => !p || typeof p.id !== 'string') || new Set(current.map(p => p.id)).size !== current.length) throw new Error('Invalid existing nutrition references');
      const byId = new Map(current.map(p => [p.id, p]));
      for (const profile of profiles) {
        if (byId.has(profile.id) && !equal(byId.get(profile.id), profile)) throw new Error(`Nutrition reference edited or conflicting: ${profile.id}`);
      }
      const extra = profiles.filter(p => !byId.has(p.id));
      // A complete system install may fill its recipes while retaining an already installed reference supplement.
      if (newer) {
        if (extra.length) throw new Error('Newer reference release is missing a required baseline sample');
        counts.ingredient_concepts_unchanged++;
        continue;
      }
      if (currentVersion === version && currentChecksum === checksum) {
        if (extra.length) throw new Error('Previously imported nutrition reference removed');
        counts.ingredient_concepts_unchanged++;
        continue;
      }
      await db.query('UPDATE ingredients_library SET base_data_payload=base_data_payload || $1::jsonb WHERE id=$2',
        [json({nutrition_references: [...current, ...extra], enrichment_version: version, enrichment_manifest_sha256: checksum}), id]);
      counts.ingredient_concepts_updated++;
      counts.references_added += extra.length;
    }
    // This release adds scoped samples only; existing recipe nutrition and edits stay intact.
    if (additions) {
      counts.recipes_skipped = data.recipes.length;
      await db.query(apply ? 'COMMIT' : 'ROLLBACK');
      return {mode: apply ? 'committed' : 'dry_run_rolled_back', version, ...counts};
    }
    for (const recipe of data.recipes) {
      const id = get('concept_methods', recipe.method_id);
      const row = (await db.query('SELECT * FROM recipes WHERE id=$1 FOR UPDATE', [id])).rows[0];
      const original = data.inputs.find(m => m.id === recipe.method_id);
      const concept = row?.base_data_payload;
      if (row?.source !== 'concept_base' || concept?.method_id !== recipe.method_id || row.external_id !== recipe.method_id || row.source_revision !== baselineVersion || concept.version !== baselineVersion) throw new Error('Refusing non-reference recipe overwrite');
      if (concept.nutrition_enrichment?.version === version) {
        if (concept.nutrition_enrichment.manifest_sha256 !== checksum) throw new Error('Immutable version mismatch');
        counts.recipes_unchanged++;
        continue;
      }
      const previous = concept.nutrition_enrichment;
      if (previous && previous.version !== versions[0]) throw new Error('Refusing recipe enrichment downgrade or unknown version');
      const expectedIngredients = original.ingredients.map(i => ({...i, amount:i.amount_text || '', ingredient_id:i.ingredient_concept_id ? get('concept_ingredients', i.ingredient_concept_id) : null}));
      if (row.quality_status !== 'reference' || !equal(row.ingredients_json, expectedIngredients) || !equal(row.steps_json, original.steps.map(s => s.text)) ||
          (row.serving_size == null ? null : Number(row.serving_size)) !== original.servings) throw new Error(`Recipe edited since snapshot: ${id}`);
      const previousPer = previous?.per_serving;
      const expectedDescription = previous ? (previousPer ? '按注明的原料形态与称量条件估算营养；每份值按原方份数计算。' : '做法参考；营养缺项和匹配依据见详情。')
        : '做法参考；营养尚未完成原料与用量匹配，暂不计算。';
      if (keys.some(k => (row[k] == null ? null : Number(row[k])) !== (previousPer ? (k === 'calories' ? Math.round(previousPer[k]) : previousPer[k]) : null)) ||
          row.nutrition_basis !== (previousPer ? 'ingredient_estimate' : 'unknown') || !equal(row.nutrition_json, []) || row.description !== expectedDescription || row.automatic_inventory_write_allowed !== false) {
        throw new Error(`Recipe nutrition edited since snapshot: ${id}`);
      }
      const references = recipe.selections.map(s => ({...s, ...data.profiles.find(p => p.id === s.profile_id)}));
      const enrichment = {...recipe, version, manifest_sha256: checksum, references,
        weighing_contract: data.contracts.find(c => c.method_id === recipe.method_id)};
      const equipment = data.equipment.filter(e => e.method_id === recipe.method_id);
      const toolIds = new Set(equipment.map(e => get('concept_kitchenware', e.concept_id)));
      const equipmentReferences = (concept.equipment_references || []).map(e => ({...e, items: e.items.filter(i => !toolIds.has(i.catalog_id))})).filter(e => e.items.length);
      for (const e of equipment) {
        const toolId = get('concept_kitchenware', e.concept_id);
        equipmentReferences.push({role: e.role, items: [{catalog_id: toolId, name: e.name}], evidence: e.evidence});
        const inserted = await db.query(`INSERT INTO recipe_kitchenware_requirements(recipe_id,catalog_id,role,source,confidence,notes)
          SELECT $1,$2,$3,'concept_enrichment',1,$4 WHERE NOT EXISTS
          (SELECT 1 FROM recipe_kitchenware_requirements WHERE recipe_id=$1 AND catalog_id=$2 AND role=$3)`,
          [id, toolId, e.role, e.evidence.map(s => `步骤 ${s.step}：${s.text}`).join('；')]);
        counts.requirements_added += inserted.rowCount;
      }
      const per = recipe.per_serving;
      const history = concept.nutrition_enrichment_history || [];
      if (concept.nutrition_enrichment) history.push(concept.nutrition_enrichment);
      await db.query(`UPDATE recipes SET calories=$1,protein=$2,carbs=$3,fat=$4,nutrition_basis=$5,
        nutrition_json='[]',description=$6,automatic_inventory_write_allowed=false,
        base_data_payload=base_data_payload || $7::jsonb WHERE id=$8`,
        [per ? Math.round(per.calories) : null, per?.protein ?? null, per?.carbs ?? null, per?.fat ?? null,
          per ? 'ingredient_estimate' : 'unknown', per ? '按注明的原料形态与称量条件估算营养；每份值按原方份数计算。' : '做法参考；营养缺项和匹配依据见详情。',
          json({nutrition_enrichment: enrichment, nutrition_enrichment_history: history, equipment_references: equipmentReferences,
            enrichment_version: version, nutrition_status: recipe.status}), id]);
      counts.recipes_updated++;
    }
    await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    return {mode: apply ? 'committed' : 'dry_run_rolled_back', version, ...counts};
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checksum = process.env.ENRICHMENT_MANIFEST_SHA256;
  const data = loadRelease(process.argv[2], checksum);
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
  const db = await pool.connect();
  try { console.log(json(await importRelease(db, data, checksum, process.argv.includes('--apply')))); }
  finally { db.release(); await pool.end(); }
}
