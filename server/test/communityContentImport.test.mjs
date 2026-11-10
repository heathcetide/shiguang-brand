import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCommunity,importCommunity} from '../scripts/import-community-content.mjs';

const data=()=>JSON.parse(readFileSync(new URL('../../artifacts/base-data/community-content-2026-09-15.1.json',import.meta.url)));
test('platform activity and FAQ have attribution, real schedules and no invented engagement',()=>{
 const d=data();validateCommunity(d);
 assert.equal(d.posts.filter(p=>p.answer).length,12);
 for(const p of d.posts){assert.equal('likes_count' in p,false);assert.equal('participant_count' in p,false);assert.match(p.content,/平台/);}
});
test('invalid schedule or missing answer is rejected',()=>{
 const d=data();d.posts[0].duration_days=0;assert.throws(()=>validateCommunity(d),/schedule/);
 const e=data();e.posts.find(p=>p.category==='问答').answer='';assert.throws(()=>validateCommunity(e),/answer/);
});
test('ranking supplement preserves existing content and reports measured sample counts',()=>{
 const next=JSON.parse(readFileSync(new URL('../../artifacts/base-data/community-content-2026-09-15.2.json',import.meta.url)));
 validateCommunity(next);
 for(const old of data().posts)assert.deepEqual(next.posts.find(p=>p.id===old.id),old);
 const rankings=next.posts.filter(p=>p.category==='榜单');assert.equal(rankings.length,3);
 for(const p of rankings){assert.match(p.content,/统计口径/);assert.equal(p.answer,null);}
 const recipes=JSON.parse(readFileSync(new URL('../../artifacts/base-data/concept-enrichment-2026-09-15.2/recipe-inputs.json',import.meta.url)));
 const salts=recipes.filter(m=>m.ingredients.some(i=>i.name==='食盐')).length;
 assert.ok(rankings.find(p=>p.id.endsWith('ingredient-frequency')).content.includes(`食盐：出现在 ${salts}/20 道菜中`));
});
test('ambiguous administrator rolls back without publishing',async()=>{
 const statements=[];
 const db={query:async sql=>{statements.push(sql);return {rows:sql.startsWith('SELECT id,username')?[{id:1},{id:2}]:[]};}};
 await assert.rejects(()=>importCommunity(db,data(),{apply:true}),/COMMUNITY_AUTHOR_ID/);
 assert.equal(statements.at(-1),'ROLLBACK');assert.equal(statements.some(s=>s.startsWith('INSERT')),false);
});
