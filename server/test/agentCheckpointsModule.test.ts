import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Pool } from "pg";
import {
  createPostgresAgentCheckpointer,
  LANGGRAPH_POSTGRES_SCHEMA_VERSION,
} from "../src/modules/agentCheckpoints/postgres.js";

type QueryResult = { rowCount: number; rows: Array<Record<string, unknown>> };

function poolWithResults(results: QueryResult[]) {
  const calls: unknown[][] = [];
  const pool = {
    query: async (...args: unknown[]) => {
      calls.push(args);
      const result = results.shift();
      if (!result) throw new Error("unexpected query");
      return result;
    },
  } as unknown as Pool;
  return { calls, pool };
}

describe("Agent checkpoint module", () => {
  test("rejects invalid PostgreSQL schema identifiers before querying", async () => {
    const { calls, pool } = poolWithResults([]);
    await assert.rejects(() => createPostgresAgentCheckpointer(pool, 'public";DROP SCHEMA public'), /名称无效/);
    assert.equal(calls.length, 0);
  });

  test("requires every Drizzle-owned checkpoint table", async () => {
    const { calls, pool } = poolWithResults([{ rowCount: 3, rows: [] }]);
    await assert.rejects(() => createPostgresAgentCheckpointer(pool), /Drizzle migration 初始化/);
    assert.equal(calls.length, 1);
  });

  test("requires the exact pinned checkpoint schema version", async () => {
    const tables = ["checkpoint_migrations", "checkpoints", "checkpoint_blobs", "checkpoint_writes"];
    const { calls, pool } = poolWithResults([
      { rowCount: tables.length, rows: tables.map((table_name) => ({ table_name })) },
      { rowCount: 1, rows: [{ version: LANGGRAPH_POSTGRES_SCHEMA_VERSION - 1 }] },
    ]);
    await assert.rejects(() => createPostgresAgentCheckpointer(pool), /版本不匹配/);
    assert.equal(calls.length, 2);
  });
});
