import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { SqliteAdminConsoleRepository } from "../src/modules/adminConsole/sqliteRepository.js";
import { PostgresAdminConsoleRepository } from "../src/modules/adminConsole/postgresRepository.js";
import { projectCoreLoops, utc, type CoreLoopDataset } from "../src/modules/adminConsole/coreLoopProjection.js";
import { coreLoopWeek, evaluateCoreLoop, summarizeCoreLoopWeek } from "../src/modules/adminConsole/coreLoopMetric.js";

const VALID_INVENTORY_JSON = JSON.stringify([
  { itemId: 11, before: "10个", after: "7个", amount: 3, unit: "piece" },
]);

for (const backend of ["sqlite", "postgres"] as const) {
  test(
    `${backend}: coreLoopData shared queries determine completion by first valid chef intake and avoid duplicates`,
    { skip: backend === "postgres" && !process.env.CORE_LOOP_TEST_PG_URL },
    async () => {
      const sqlite = backend === "sqlite" ? new Database(":memory:") : null;
      const admin = backend === "postgres" ? new Pool({ connectionString: process.env.CORE_LOOP_TEST_PG_URL }) : null;
      const dbName = `core_loop_repo_test_${randomUUID().replaceAll("-", "")}`;
      let pool: Pool | null = null;
      if (admin) {
        await admin.query(`CREATE DATABASE ${dbName}`);
        const url = new URL(process.env.CORE_LOOP_TEST_PG_URL!);
        url.pathname = `/${dbName}`;
        pool = new Pool({ connectionString: url.toString() });
      }

      const exec = async (sql: string) => {
        if (sqlite) sqlite.exec(sql);
        else await pool!.query(sql);
      };
      const run = async (sql: string, args: unknown[] = []) => {
        if (sqlite) sqlite.prepare(sql).run(...args);
        else {
          let index = 0;
          await pool!.query(sql.replaceAll("?", () => `$${++index}`), args);
        }
      };

      const time = (iso: string) => {
        if (sqlite) return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
        return iso.endsWith("Z") ? iso : `${iso}Z`;
      };

      try {
        const timestamp = sqlite ? "TEXT" : "TIMESTAMPTZ";
        const json = sqlite ? "TEXT" : "JSONB";

        await exec(`
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT
          );
          CREATE TABLE core_loop_actor_classifications (
            user_id INTEGER PRIMARY KEY,
            kind TEXT
          );
          CREATE TABLE core_loop_metric_settings (
            id INTEGER PRIMARY KEY,
            enabled INTEGER,
            version INTEGER,
            coverage_start ${timestamp},
            environment TEXT
          );
          CREATE TABLE prepared_meals (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            idempotency_key TEXT,
            recipe_id INTEGER,
            produced_at ${timestamp},
            result_json ${json}
          );
          CREATE TABLE recipe_recommendation_requests (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            created_at ${timestamp}
          );
          CREATE TABLE prepared_meal_events (
            id ${sqlite ? "INTEGER PRIMARY KEY" : "SERIAL PRIMARY KEY"},
            prepared_meal_id TEXT,
            user_id INTEGER,
            event_type TEXT,
            servings REAL,
            created_at ${timestamp},
            diet_record_id INTEGER
          );
          CREATE TABLE prepared_meal_intake_corrections (
            id ${sqlite ? "INTEGER PRIMARY KEY" : "SERIAL PRIMARY KEY"},
            event_id INTEGER
          );
          CREATE TABLE diet_records (
            id INTEGER PRIMARY KEY,
            user_id INTEGER
          );
          CREATE TABLE inventory_change_logs (
            user_id INTEGER,
            inventory_item_id INTEGER,
            action TEXT,
            source TEXT,
            quantity_before REAL,
            quantity_after REAL,
            delta_value REAL,
            idempotency_key TEXT,
            created_at ${timestamp},
            metadata_json ${json}
          );
          CREATE TABLE cooking_completions (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            recipe_id INTEGER,
            diet_record_id INTEGER,
            created_at ${timestamp}
          );
          CREATE TABLE household_meal_batches (
            id TEXT PRIMARY KEY,
            household_id INTEGER,
            created_by_user_id INTEGER,
            plan_item_id TEXT,
            idempotency_key TEXT,
            inventory_json ${json},
            request_json ${json},
            dining_json ${json},
            created_at ${timestamp}
          );
          CREATE TABLE household_meal_events (
            id ${sqlite ? "INTEGER PRIMARY KEY" : "SERIAL PRIMARY KEY"},
            meal_id TEXT,
            diet_record_id INTEGER,
            user_id INTEGER,
            servings REAL,
            created_at ${timestamp}
          );
          CREATE TABLE household_meal_intake_corrections (
            id ${sqlite ? "INTEGER PRIMARY KEY" : "SERIAL PRIMARY KEY"},
            event_id INTEGER
          );
          CREATE TABLE meal_plan_items (
            id TEXT PRIMARY KEY,
            recipe_id INTEGER
          );
        `);

        // Seed users: user 1 (chef), user 2 (diner)
        await run("INSERT INTO users(id, username) VALUES(?, ?)", [1, "chef"]);
        await run("INSERT INTO users(id, username) VALUES(?, ?)", [2, "family_diner"]);
        await run("INSERT INTO core_loop_actor_classifications(user_id, kind) VALUES(?, ?)", [1, "real"]);
        await run("INSERT INTO core_loop_actor_classifications(user_id, kind) VALUES(?, ?)", [2, "real"]);
        await run(
          "INSERT INTO core_loop_metric_settings(id, enabled, version, coverage_start, environment) VALUES(?, ?, ?, ?, ?)",
          [1, 1, 1, time("2026-09-01T00:00:00.000Z"), "staging"]
        );
        await run("INSERT INTO meal_plan_items(id, recipe_id) VALUES(?, ?)", ["plan-item-1", 7]);

        const insertBatch = async (batchId: string, producedAt: string) => {
          await run(
            `INSERT INTO household_meal_batches(id, household_id, created_by_user_id, plan_item_id, idempotency_key, inventory_json, request_json, dining_json, created_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              batchId,
              1,
              1,
              "plan-item-1",
              `idemp-${batchId}`,
              VALID_INVENTORY_JSON,
              "{}",
              "{}",
              time(producedAt),
            ]
          );
        };

        const insertEvent = async (
          eventId: number,
          batchId: string,
          recordId: number,
          userId: number,
          createdAt: string,
          recordExists = true,
          corrected = false
        ) => {
          if (recordExists) {
            await run("INSERT INTO diet_records(id, user_id) VALUES(?, ?)", [recordId, userId]);
          }
          await run(
            `INSERT INTO household_meal_events(id, meal_id, diet_record_id, user_id, servings, created_at)
             VALUES(?, ?, ?, ?, ?, ?)`,
            [eventId, batchId, recordId, userId, 1, time(createdAt)]
          );
          if (corrected) {
            await run("INSERT INTO household_meal_intake_corrections(event_id) VALUES(?)", [eventId]);
          }
        };

        // 1. Core regression: batch-1 has two chef intakes crossing Shanghai week boundary
        // Week 1 (2026-09-12): ends at 2026-09-13 16:00:00Z
        // Intake 1: 2026-09-13 15:59:59Z (Sun 23:59:59 Asia/Shanghai) -> Week 1
        // Intake 2: 2026-09-13 16:00:00Z (Mon 00:00:00 Asia/Shanghai) -> Week 2
        await insertBatch("batch-1", "2026-09-13T12:00:00.000Z");
        await insertEvent(1, "batch-1", 101, 1, "2026-09-13T15:59:59.000Z");
        await insertEvent(2, "batch-1", 102, 1, "2026-09-13T16:00:00.000Z");

        // 2. Non-chef eats first: batch-2
        // Diner eats in Week 1 (2026-09-13 14:00:00Z)
        // Chef eats in Week 2 (2026-09-14 12:00:00Z)
        await insertBatch("batch-2", "2026-09-13T12:00:00.000Z");
        await insertEvent(21, "batch-2", 201, 2, "2026-09-13T14:00:00.000Z");
        await insertEvent(22, "batch-2", 202, 1, "2026-09-14T12:00:00.000Z");

        // 3. First chef intake corrected: batch-3
        // Chef eats in Week 1 (2026-09-13 15:00:00Z), but event 31 is corrected
        // Chef eats again in Week 2 (2026-09-14 13:00:00Z), surviving
        await insertBatch("batch-3", "2026-09-13T12:00:00.000Z");
        await insertEvent(31, "batch-3", 301, 1, "2026-09-13T15:00:00.000Z", true, true);
        await insertEvent(32, "batch-3", 302, 1, "2026-09-14T13:00:00.000Z", true, false);

        // 4. First chef intake diet record deleted: batch-4
        // Chef eats in Week 1 (2026-09-13 15:30:00Z), but diet record is missing
        // Chef eats again in Week 2 (2026-09-14 14:00:00Z), valid diet record
        await insertBatch("batch-4", "2026-09-13T12:00:00.000Z");
        await insertEvent(41, "batch-4", 401, 1, "2026-09-13T15:30:00.000Z", false, false);
        await insertEvent(42, "batch-4", 402, 1, "2026-09-14T14:00:00.000Z", true, false);

        // 5. All chef intakes invalid: batch-5
        // Chef eats in Week 1, but corrected; no surviving intakes
        await insertBatch("batch-5", "2026-09-13T12:00:00.000Z");
        await insertEvent(51, "batch-5", 501, 1, "2026-09-13T15:45:00.000Z", true, true);

        // 6. Multiple chef intakes within same week: batch-6
        // Chef eats twice in Week 1: 13:00:00Z and 15:00:00Z
        await insertBatch("batch-6", "2026-09-13T10:00:00.000Z");
        await insertEvent(61, "batch-6", 601, 1, "2026-09-13T13:00:00.000Z", true, false);
        await insertEvent(62, "batch-6", 602, 1, "2026-09-13T15:00:00.000Z", true, false);

        const repository = sqlite
          ? new SqliteAdminConsoleRepository(sqlite)
          : new PostgresAdminConsoleRepository(pool!);

        const attachSyntheticTestEvidence = (data: CoreLoopDataset): CoreLoopDataset => ({
          ...data,
          shared: data.shared.map(row => ({
            ...row,
            selection_evidence: {
              version: 1,
              requestId: `test-synthetic-req-${row.id}`,
              recipeId: Number(row.recipe_id ?? 7),
              selectedAt: "2026-09-12 00:00:00",
              inventory: { version: 1, allocations: [{ itemId: 11 }] },
            },
            stock: [{
              itemId: 11,
              confirmedAt: "2026-09-11 00:00:00",
              confirmed: true,
              scope: "household",
              ownerKey: `household:${row.household_id ?? 1}`,
            }],
          })),
        });

        // 1. Direct assertions on raw repository queries: verify full surviving history is returned
        const week1 = coreLoopWeek("2026-09-12");
        const rawDataW1 = await repository.coreLoopData(week1.start, week1.end);

        // batch-1: full surviving history has both Week 1 and Week 2 chef intakes
        const batch1Events = rawDataW1.shared.filter(r => r.id === "batch-1");
        assert.equal(batch1Events.length, 2, "batch-1 must return all surviving intakes in W1 query");
        assert.ok(batch1Events.some(r => utc(r.intake_at).includes("15:59:59")));
        assert.ok(batch1Events.some(r => utc(r.intake_at).includes("16:00:00")));

        // batch-2: returns both diner intake and surviving chef intake
        const batch2Events = rawDataW1.shared.filter(r => r.id === "batch-2");
        assert.equal(batch2Events.length, 2, "batch-2 must return both diner and surviving chef intake");

        // batch-3: corrected event (31) is excluded, surviving event (32) is returned
        const batch3Events = rawDataW1.shared.filter(r => r.id === "batch-3");
        assert.equal(batch3Events.length, 1, "batch-3 corrected intake must be excluded");
        assert.equal(Number(batch3Events[0].diet_record_id), 302);

        // batch-4: deleted diet record (41) is excluded by JOIN, surviving event (42) is returned
        const batch4Events = rawDataW1.shared.filter(r => r.id === "batch-4");
        assert.equal(batch4Events.length, 1, "batch-4 deleted diet record must be excluded");
        assert.equal(Number(batch4Events[0].diet_record_id), 402);

        // batch-5: all events corrected -> excluded from shared
        const batch5Events = rawDataW1.shared.filter(r => r.id === "batch-5");
        assert.equal(batch5Events.length, 0, "batch-5 has no surviving intake and must not appear");

        // 2. Unverified raw data without recommendation selection or stock evidence marks the week partial
        const rawFactsW1 = projectCoreLoops(rawDataW1);
        for (const f of rawFactsW1) {
          assert.equal(f.selection, null, `raw W1 fact ${f.productionId} selection must be null`);
          assert.deepEqual(f.stock, [], `raw W1 fact ${f.productionId} stock must be empty`);
          assert.equal(evaluateCoreLoop(f, "staging").reason, "selection_missing", `raw W1 fact ${f.productionId} must be selection_missing`);
        }
        const rawSummaryW1 = summarizeCoreLoopWeek(rawFactsW1, {
          date: "2026-09-12",
          targetEnvironment: "staging",
          coverageStart: "2026-09-01T00:00:00Z",
          now: "2026-09-28T00:00:00Z",
        });
        assert.equal(rawSummaryW1.status, "partial", "unverified raw W1 data must mark week partial");
        assert.equal(rawSummaryW1.verifiedLoops, 0, "unverified raw W1 data must have verifiedLoops = 0");
        assert.equal(rawSummaryW1.users, null, "unverified raw W1 data must have users = null");
        assert.equal(rawSummaryW1.unknown, 2, "raw W1 unknown must be exactly 2 (batch-1 and batch-6)");

        const week2 = coreLoopWeek("2026-09-14");
        const rawDataW2 = await repository.coreLoopData(week2.start, week2.end);
        const rawFactsW2 = projectCoreLoops(rawDataW2);
        for (const f of rawFactsW2) {
          assert.equal(f.selection, null, `raw W2 fact ${f.productionId} selection must be null`);
          assert.deepEqual(f.stock, [], `raw W2 fact ${f.productionId} stock must be empty`);
          assert.equal(evaluateCoreLoop(f, "staging").reason, "selection_missing", `raw W2 fact ${f.productionId} must be selection_missing`);
        }
        const rawSummaryW2 = summarizeCoreLoopWeek(rawFactsW2, {
          date: "2026-09-14",
          targetEnvironment: "staging",
          coverageStart: "2026-09-01T00:00:00Z",
          now: "2026-09-28T00:00:00Z",
        });
        assert.equal(rawSummaryW2.status, "partial", "unverified raw W2 data must mark week partial");
        assert.equal(rawSummaryW2.verifiedLoops, 0, "unverified raw W2 data must have verifiedLoops = 0");
        assert.equal(rawSummaryW2.users, null, "unverified raw W2 data must have users = null");
        assert.equal(rawSummaryW2.unknown, 4, "raw W2 unknown must be exactly 4 (batch-1, batch-2, batch-3, batch-4)");

        const week3 = coreLoopWeek("2026-09-21");
        const rawDataW3 = await repository.coreLoopData(week3.start, week3.end);
        const rawFactsW3 = projectCoreLoops(rawDataW3);
        const rawSummaryW3 = summarizeCoreLoopWeek(rawFactsW3, {
          date: "2026-09-21",
          targetEnvironment: "staging",
          coverageStart: "2026-09-01T00:00:00Z",
          now: "2026-09-28T00:00:00Z",
        });
        assert.equal(rawSummaryW3.unknown, 0, "raw W3 unknown must be exactly 0 (no activity)");

        // 3. Test-layer evidence evaluation preserving original week boundary totals (W1=2, W2=3, W3=0)
        const evaluateWeekWithEvidence = async (date: string) => {
          const week = coreLoopWeek(date);
          const data = await repository.coreLoopData(week.start, week.end);
          const facts = projectCoreLoops(attachSyntheticTestEvidence(data));
          return summarizeCoreLoopWeek(facts, {
            date,
            targetEnvironment: "staging",
            coverageStart: "2026-09-01T00:00:00Z",
            now: "2026-09-28T00:00:00Z",
          });
        };

        const reportWeek1 = await evaluateWeekWithEvidence("2026-09-12");
        const reportWeek2 = await evaluateWeekWithEvidence("2026-09-14");
        const reportWeek3 = await evaluateWeekWithEvidence("2026-09-21");

        // --- Week 1 verifications ---
        // batch-1: completes at 2026-09-13T15:59:59.000Z in Week 1
        const eval1_w1 = reportWeek1.evaluations.find(e => e.productionId === "household:batch-1");
        assert.ok(eval1_w1, "batch-1 must be present in Week 1 evaluations");
        assert.equal(eval1_w1.reason, "included");
        assert.equal(eval1_w1.completedAt, "2026-09-13T15:59:59.000Z");

        // batch-2: non-chef ate in Week 1, chef ate in Week 2 -> full history sees chef Week 2 intake,
        // so reason is included with completedAt in Week 2, but Week 1 summary excludes it
        const eval2_w1 = reportWeek1.evaluations.find(e => e.productionId === "household:batch-2");
        assert.ok(eval2_w1, "batch-2 must be present in Week 1 evaluations due to diner Week 1 intake");
        assert.equal(eval2_w1.reason, "included");
        assert.equal(eval2_w1.completedAt, "2026-09-14T12:00:00.000Z");

        // batch-3: chef Week 1 intake corrected, chef Week 2 intake survives -> completedAt is Week 2
        const eval3_w1 = reportWeek1.evaluations.find(e => e.productionId === "household:batch-3");
        assert.ok(eval3_w1, "batch-3 must be present in Week 1 evaluations");
        assert.equal(eval3_w1.reason, "included");
        assert.equal(eval3_w1.completedAt, "2026-09-14T13:00:00.000Z");

        // batch-4: chef Week 1 diet record deleted, chef Week 2 survives -> completedAt is Week 2
        const eval4_w1 = reportWeek1.evaluations.find(e => e.productionId === "household:batch-4");
        assert.ok(eval4_w1, "batch-4 must be present in Week 1 evaluations");
        assert.equal(eval4_w1.reason, "included");
        assert.equal(eval4_w1.completedAt, "2026-09-14T14:00:00.000Z");

        // batch-5: all chef intakes corrected -> no surviving intake returned
        const eval5_w1 = reportWeek1.evaluations.find(e => e.productionId === "household:batch-5");
        assert.equal(eval5_w1 === undefined || eval5_w1.reason !== "included", true);

        // batch-6: multiple intakes in Week 1 completes at earliest intake 13:00:00Z
        const eval6_w1 = reportWeek1.evaluations.find(e => e.productionId === "household:batch-6");
        assert.ok(eval6_w1, "batch-6 must be present in Week 1 evaluations");
        assert.equal(eval6_w1.reason, "included");
        assert.equal(eval6_w1.completedAt, "2026-09-13T13:00:00.000Z");

        // Week 1 totals: exactly batch-1 and batch-6 completed
        assert.equal(reportWeek1.users, 1, `Week 1 users expected 1, got ${reportWeek1.users}`);
        assert.equal(reportWeek1.loops, 2, `Week 1 loops expected 2, got ${reportWeek1.loops}`);

        // --- Week 2 verifications ---
        // batch-1: must be evaluated in Week 2 (because of Week 2 intake event) and point to Week 1 completedAt
        const eval1_w2 = reportWeek2.evaluations.find(e => e.productionId === "household:batch-1");
        assert.ok(eval1_w2, "batch-1 must be evaluated in Week 2");
        assert.equal(eval1_w2.reason, "included");
        assert.equal(eval1_w2.completedAt, "2026-09-13T15:59:59.000Z");

        // batch-2: completed in Week 2 when chef first ate
        const eval2_w2 = reportWeek2.evaluations.find(e => e.productionId === "household:batch-2");
        assert.ok(eval2_w2, "batch-2 must be evaluated in Week 2");
        assert.equal(eval2_w2.reason, "included");
        assert.equal(eval2_w2.completedAt, "2026-09-14T12:00:00.000Z");

        // batch-3: completed in Week 2 (Week 1 was corrected)
        const eval3_w2 = reportWeek2.evaluations.find(e => e.productionId === "household:batch-3");
        assert.ok(eval3_w2, "batch-3 must be evaluated in Week 2");
        assert.equal(eval3_w2.reason, "included");
        assert.equal(eval3_w2.completedAt, "2026-09-14T13:00:00.000Z");

        // batch-4: completed in Week 2 (Week 1 record deleted)
        const eval4_w2 = reportWeek2.evaluations.find(e => e.productionId === "household:batch-4");
        assert.ok(eval4_w2, "batch-4 must be evaluated in Week 2");
        assert.equal(eval4_w2.reason, "included");
        assert.equal(eval4_w2.completedAt, "2026-09-14T14:00:00.000Z");

        // batch-5: never included
        const eval5_w2 = reportWeek2.evaluations.find(e => e.productionId === "household:batch-5");
        assert.equal(eval5_w2 === undefined || eval5_w2.reason !== "included", true);

        // batch-6: completed in Week 1, had no events in Week 2
        const eval6_w2 = reportWeek2.evaluations.find(e => e.productionId === "household:batch-6");
        assert.equal(eval6_w2, undefined);

        // Week 2 totals: exactly batch-2, batch-3, batch-4 completed (loops = 3, users = 1)
        // If batch-1 or batch-6 duplicated, loops would be 4 or 5!
        assert.equal(reportWeek2.loops, 3, `Week 2 loops expected 3, got ${reportWeek2.loops}`);
        assert.equal(reportWeek2.users, 1, `Week 2 users expected 1, got ${reportWeek2.users}`);

        // --- Week 3 verifications ---
        // No activity in Week 3 -> 0 users, 0 loops
        assert.equal(reportWeek3.loops, 0, `Week 3 loops expected 0, got ${reportWeek3.loops}`);
        assert.equal(reportWeek3.users, 0, `Week 3 users expected 0, got ${reportWeek3.users}`);
      } finally {
        sqlite?.close();
        if (pool) await pool.end();
        if (admin) {
          await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
          await admin.end();
        }
      }
    }
  );
}
