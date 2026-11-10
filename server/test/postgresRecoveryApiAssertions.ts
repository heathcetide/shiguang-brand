import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPostgresBackup,restorePostgresBackup } from "../src/services/backup/postgres.js";

type Json = Record<string,any>;
async function start(url: string) {
  const child = spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("../src/index.ts",import.meta.url))],{
    cwd: fileURLToPath(new URL("../",import.meta.url)),
    env: { ...process.env,DATABASE_DRIVER: "postgresql",DATABASE_URL: url,NODE_ENV: "test",HOST: "127.0.0.1",PORT: "0",REQUIRE_HTTPS: "0",ENABLE_DEMO_SEED: "0",JWT_SECRET: "isolated-recovery-test-secret-at-least-32-characters",ERROR_MONITOR_WEBHOOK_URL: "" },stdio: ["ignore","pipe","pipe"],
  });
  const baseUrl = await new Promise<string>((resolve,reject) => {
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Recovery API startup timed out")); },20_000);
    const consume = (chunk: Buffer) => {
      output = (output+chunk.toString()).slice(-8000);
      const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)\//);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stdout.on("data",consume); child.stderr.on("data",consume);
    child.once("error",error => { clearTimeout(timer); reject(error); });
    child.once("exit",code => { clearTimeout(timer); reject(new Error(`Recovery API exited (${code}): ${output}`)); });
  });
  return { url: baseUrl,close: async () => {
    if (child.exitCode!==null || child.signalCode!==null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill("SIGKILL"),5_000);
      child.once("exit",() => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    });
  } };
}
async function request(base: string,route: string,token?: string,body?: Json) {
  const response = await fetch(`${base}/api/v1${route}`,{ method: body ? "POST" : "GET",headers: { "content-type": "application/json",...(token ? { authorization: `Bearer ${token}` } : {}) },...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok,`${route} returned ${response.status}`);
  return response.json() as Promise<any>;
}
export async function verifyPostgresRecoveryApi(sourceUrl: string) {
  const pool = new Pool({ connectionString: sourceUrl });
  const targetName = `recovery_http_${randomUUID().replaceAll('-','')}`;
  const targetUrl = new URL(sourceUrl); targetUrl.pathname=`/${targetName}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),"dietdigidose-pg-recovery-http-"));
  let runtime: Awaited<ReturnType<typeof start>> | undefined; let target: Pool | undefined; let created = false;
  try {
    runtime = await start(sourceUrl);
    const suffix = randomUUID().slice(0,8); const password = 'RecoveryOnly12345';
    const identifiers = [`restore-a-${suffix}@example.invalid`,`restore-b-${suffix}@example.invalid`];
    const users = [];
    for (const [index,identifier] of identifiers.entries()) users.push(await request(runtime.url,'/auth/register',undefined,{ identifier,password,username: `恢复${index}${suffix}` }));
    await pool.query("UPDATE users SET role='admin' WHERE id=$1",[users[0].user.id]);
    const admin = await request(runtime.url,'/auth/login',undefined,{ identifier: identifiers[0],password });
    const stocks: Json[] = [];
    for (const [index,user] of users.entries()) stocks.push(await request(runtime.url,'/inventory',user.token,{ food_name: `恢复库存${index}`,category: '其他',quantity: '2.25g',quantity_value: 2.25,quantity_unit: 'g',expiration_date: '2099-01-01',storage_location: '冷藏' }));
    const made = await request(runtime.url,'/diet-records/cooking-completions',users[0].token,{ idempotency_key: `restore-production-${suffix}`,inventory_consumptions: [{ item_id: stocks[0].id,version: stocks[0].version,mode: 'amount',amount_value: 0.25,unit: 'g' }],production: { food_name: '恢复验证备餐',produced_servings: 2,eaten_servings: 1,meal_type: '午餐',eaten_at: new Date().toISOString().slice(0,10) } });
    const media = `https://media.example.invalid/restore/${suffix}.png`;
    const postId = (await pool.query("INSERT INTO community_posts(user_id,username,content,image_urls) VALUES($1,$2,'恢复引用测试',$3) RETURNING id",[users[0].user.id,users[0].user.username,JSON.stringify([media])])).rows[0].id;
    const beforeStats = await request(runtime.url,'/admin/stats',admin.token);
    const backup = path.join(directory,'snapshot');
    await createPostgresBackup(sourceUrl,backup,{ owner: 'http-recovery-integration',candidateSha: 'a'.repeat(40) });
    // Distinguish the restored snapshot from the still-existing source database.
    await pool.query("UPDATE inventory_items SET quantity_value=99,version=version+1 WHERE id=$1",[stocks[0].id]);
    await runtime.close(); runtime=undefined;
    await pool.query(`CREATE DATABASE "${targetName}"`); created=true;
    await restorePostgresBackup(targetUrl.toString(),backup);
    target = new Pool({ connectionString: targetUrl.toString() });
    runtime = await start(targetUrl.toString());
    assert.equal((await request(runtime.url,'/health')).databaseDriver,'postgresql');
    const restored = [];
    for (const identifier of identifiers) restored.push(await request(runtime.url,'/auth/login',undefined,{ identifier,password }));
    assert.deepEqual(restored.map(user => user.user.id),users.map(user => user.user.id));
    for (const [index,user] of restored.entries()) {
      const inventory = await request(runtime.url,'/inventory',user.token) as Json[];
      assert.equal(inventory.find(row => row.id===stocks[index].id)?.quantity_value,index===0 ? 2 : 2.25);
      assert.ok(!inventory.some(row => row.id===stocks[1-index].id));
    }
    const meals = await request(runtime.url,'/diet-records/prepared-meals',restored[0].token) as Json[];
    assert.equal(meals.find(row => row.id===made.prepared_meal.id)?.remaining_servings,1);
    const intakes = await request(runtime.url,'/diet-records',restored[0].token) as Json[];
    assert.equal(intakes.filter(row => row.id===made.diet_record.id).length,1);
    assert.deepEqual(await request(runtime.url,'/diet-records',restored[1].token),[]);
    assert.deepEqual(await request(runtime.url,'/admin/stats',restored[0].token),beforeStats);
    const denied = await fetch(`${runtime.url}/api/v1/admin/stats`,{ headers: { authorization: `Bearer ${restored[1].token}` } });
    assert.equal(denied.status,403);
    assert.equal(Number((await pool.query("SELECT quantity_value FROM inventory_items WHERE id=$1",[stocks[0].id])).rows[0].quantity_value),99);
    const images = (await target.query('SELECT image_urls FROM community_posts WHERE id=$1',[postId])).rows[0].image_urls;
    assert.deepEqual(typeof images==='string' ? JSON.parse(images) : images,[media]);
  } finally {
    await runtime?.close(); await target?.end();
    if (created) await pool.query(`DROP DATABASE "${targetName}"`);
    await pool.end(); await fs.rm(directory,{ recursive: true,force: true });
  }
}
