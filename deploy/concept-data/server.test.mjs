import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, loadData } from './server.mjs';
const data=loadData('artifacts/base-data/concept-base-1.0.0-rc.2');
async function run(auth,fn){const server=createServer(data,{fetcher:async()=>auth});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn('http://127.0.0.1:'+server.address().port);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
const admin=()=>new Response(JSON.stringify({role:'admin'}));
const get=(base,path,token=true)=>fetch(base+'/data-lab/api/'+path,{headers:token?{authorization:'Bearer test'}:{}});
test('anonymous cannot read data',()=>run(admin(),async base=>assert.equal((await get(base,'summary',false)).status,401)));
test('non-admin cannot read data',()=>run(new Response(JSON.stringify({role:'user'})),async base=>assert.equal((await get(base,'summary')).status,403)));
test('expired login fails closed',()=>run(new Response('{}',{status:401}),async base=>assert.equal((await get(base,'summary')).status,401)));
test('administrator sees verified release',()=>run(admin(),async base=>{const r=await get(base,'summary');assert.equal(r.status,200);assert.equal((await r.json()).cn6_source_foods,1677);}));
test('regional ambiguity retained',()=>run(admin(),async base=>{const r=await get(base,'concepts?q='+encodeURIComponent('土豆'));const d=await r.json();assert.ok(d.items.some(x=>x.id==='WD-Q16587531'));assert.ok(d.total>=2);}));
test('concept includes forms',()=>run(admin(),async base=>{const r=await get(base,'concept?id=WD-Q15260613');const d=await r.json();assert.equal(d.concept.name_zh,'鸡蛋');assert.ok(d.forms.length>=2);}));
test('CN6 candidate is not a runtime binding',()=>run(admin(),async base=>{const r=await get(base,'nutrition?id=CN6:091101x');const d=await r.json();assert.equal(r.status,200);assert.equal(d.record.usage_status,'local_candidate');}));
test('static shell does not embed source data',()=>run(admin(),async base=>{const r=await fetch(base+'/data-lab/');const t=await r.text();assert.ok(t.includes('概念数据测试'));assert.ok(!t.includes('energyKCal'));}));
