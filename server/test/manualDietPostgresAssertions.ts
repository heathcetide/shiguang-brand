import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DietRecordsService } from "../src/modules/dietRecords/service.js";
import { PostgresDietRecordsRepository } from "../src/modules/dietRecords/postgresRepository.js";

export async function verifyManualDietPostgres(pool:Pool) {
  const suffix=randomUUID().replace(/-/g,"");const ids:number[]=[];
  const service=new DietRecordsService(new PostgresDietRecordsRepository(pool,async () => {throw new Error("Manual diet must not consume inventory");}));
  const requestKey=`manual-${suffix}`;
  const input={idempotency_key:requestKey,meal_type:"午餐",food_name:"手动饮食事务",amount:"1份",recorded_at:"2026-09-20",recorded_time:"12:30",calories:0};
  try {
    for(let index=0;index<2;index++) ids.push(Number((await pool.query("INSERT INTO users(username,password_hash) VALUES($1,'fixture') RETURNING id",[`manual-diet-${suffix}-${index}`])).rows[0].id));
    const [first,second]=await Promise.all([service.create(ids[0],input),service.create(ids[0],input)]);
    assert.equal(first.id,second.id);assert.equal([first,second].filter((item) => item.repeated===false).length,1);
    assert.equal((await pool.query("SELECT COUNT(*)::integer n FROM diet_records WHERE user_id=$1",[ids[0]])).rows[0].n,1);
    await assert.rejects(service.create(ids[0],{...input,food_name:"不同食物"}),(error:any) => error.code==="DIET_RECORD_KEY_CONFLICT");
    assert.notEqual((await service.create(ids[1],input)).id,first.id);
    await pool.query("DELETE FROM diet_records WHERE id=$1",[first.id]);
    await assert.rejects(service.create(ids[0],input),(error:any) => error.status===410 && error.code==="DIET_RECORD_REQUEST_DELETED");
    assert.equal((await pool.query("SELECT diet_record_id FROM diet_record_create_requests WHERE user_id=$1 AND request_key=$2",[ids[0],requestKey])).rows[0].diet_record_id,null);

    const functionName=`manual_diet_fail_${suffix}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id=${ids[0]} THEN RAISE EXCEPTION 'manual receipt fixture failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${functionName} BEFORE INSERT ON diet_record_create_requests FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      await assert.rejects(service.create(ids[0],{...input,idempotency_key:`failure-${suffix}`}),/manual receipt fixture failure/);
      assert.equal((await pool.query("SELECT COUNT(*)::integer n FROM diet_records WHERE user_id=$1",[ids[0]])).rows[0].n,0);
    } finally {await pool.query(`DROP TRIGGER ${functionName} ON diet_record_create_requests; DROP FUNCTION ${functionName}()`);}
    const legacy={meal_type:"晚餐",food_name:"旧端记录",amount:"1份"};
    assert.notEqual((await service.create(ids[0],legacy)).id,(await service.create(ids[0],legacy)).id);
    for (const calories of [0.04, 0, null]) {
      const fractional = { ...legacy, calories, protein: null, carbs: 0, fat: null, idempotency_key: `precision-${calories}-${suffix}` };
      const saved = await service.create(ids[0], fractional);
      assert.equal(saved.calories, calories);
      assert.equal((await service.create(ids[0], fractional)).calories, calories);
      const stored = (await pool.query("SELECT calories,protein,carbs,fat FROM diet_records WHERE id=$1", [saved.id])).rows[0];
      assert.deepEqual(stored, { calories, protein: null, carbs: 0, fat: null });
    }
  } finally {if(ids.length) await pool.query("DELETE FROM users WHERE id=ANY($1::integer[])",[ids]);}
}
