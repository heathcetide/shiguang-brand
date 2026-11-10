// One transaction for concepts, scoped nutrition and platform editorial content.
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { importConcept } from './import-concept-runtime.mjs';
import { loadRelease, importRelease } from './import-nutrition-enrichment.mjs';
import { validateCommunity, importCommunity } from './import-community-content.mjs';

const sha = raw => createHash('sha256').update(raw).digest('hex');
export function loadSystemPackage(root) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json')));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Invalid package manifest');
  }
  // Every independently consumed payload must be covered before reading it.
  // Nutrition payloads are also verified against their nested manifest by loadRelease.
  for (const path of ['data/runtime-input.json', 'data/community.json', 'data/nutrition/manifest.json']) {
    if (!Object.hasOwn(manifest.files, path)) throw new Error('Missing required package member: ' + path);
  }
  for (const [path, checksum] of Object.entries(manifest.files)) {
    if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum)) {
      throw new Error('Invalid package checksum: ' + path);
    }
  }
  for (const [path, checksum] of Object.entries(manifest.files)) {
    if (path.includes('..') || path.startsWith('/') || path.includes('\\')) throw new Error('Invalid package path');
    if (sha(readFileSync(resolve(root, path))) !== checksum) throw new Error('Package checksum mismatch: ' + path);
  }
  const baseline = JSON.parse(readFileSync(resolve(root, 'data/runtime-input.json')));
  const nutrition = loadRelease(resolve(root, 'data/nutrition'), manifest.files['data/nutrition/manifest.json']);
  const community = JSON.parse(readFileSync(resolve(root, 'data/community.json')));
  validateCommunity(community);
  if (!['system-data-2026-09-15.1','system-data-2026-09-15.2'].includes(manifest.version) || baseline.methods.length !== 389) throw new Error('Unexpected package version');
  return {manifest,baseline,nutrition,community};
}

export async function importSystem(db, data, {apply=false,authorId,activation}={}) {
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='180s'");
    await db.query('SELECT pg_advisory_xact_lock(187,8)');
    await db.query(`CREATE TABLE IF NOT EXISTS system_data_package_imports(version text PRIMARY KEY, manifest_sha256 text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now())`);
    const digest=sha(JSON.stringify(data.manifest));
    const old=(await db.query('SELECT * FROM system_data_package_imports WHERE version=$1',[data.manifest.version])).rows[0];
    if(old){
      if(old.manifest_sha256!==digest)throw new Error('Immutable package version changed');
      await db.query(apply?'COMMIT':'ROLLBACK');
      return {mode:apply?'committed':'dry_run_rolled_back',version:data.manifest.version,already_imported:true};
    }
    // Existing imported concept releases are not reset by a second full-package run.
    // Each stage uses a savepoint; only the outer transaction may commit.
    const stage={query:async(text,values)=>{
      if(text==='BEGIN')return db.query('SAVEPOINT package_stage');
      if(text==='COMMIT')return db.query('RELEASE SAVEPOINT package_stage');
      if(text==='ROLLBACK')return db.query('ROLLBACK TO SAVEPOINT package_stage');
      return db.query(text,values);
    }};
    const exists=(await db.query("SELECT count(*)::int AS count FROM base_data_runtime_ids WHERE collection='concept_methods' AND imported_version='concept-base-1.0.0-rc.2'")).rows[0].count;
    const reports=[];
    if(exists===0)reports.push(await importConcept(stage,data.baseline,{apply:true,checksum:data.manifest.files['data/runtime-input.json']}));
    else if(exists!==389)throw new Error('Partial baseline import; review before proceeding');
    else reports.push({baseline:'existing_389_methods_preserved'});
    reports.push(await importRelease(stage,data.nutrition,data.manifest.files['data/nutrition/manifest.json'],true,{preserveNewerReferences:true}));
    reports.push(await importCommunity(stage,data.community,{apply:true,authorId,activation}));
    await db.query('INSERT INTO system_data_package_imports(version,manifest_sha256) VALUES($1,$2)',[data.manifest.version,digest]);
    await db.query(apply?'COMMIT':'ROLLBACK');
    return {mode:apply?'committed':'dry_run_rolled_back',version:data.manifest.version,reports};
  }catch(error){await db.query('ROLLBACK');throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const directories=process.argv.slice(2).filter(arg=>arg!=='--apply');
  if(directories.length>1)throw new Error('Usage: import-system-data.mjs [package-directory] [--apply]');
  const root=directories.length?resolve(directories[0]):resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const data=loadSystemPackage(root);
  if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});const db=await pool.connect();
  try{console.log(JSON.stringify(await importSystem(db,data,{apply:process.argv.includes('--apply'),authorId:Number(process.env.COMMUNITY_AUTHOR_ID)||undefined,activation:process.env.COMMUNITY_ACTIVATION_AT})));}
  finally{db.release();await pool.end();}
}
