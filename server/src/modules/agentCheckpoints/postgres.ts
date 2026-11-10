import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";

export const LANGGRAPH_POSTGRES_SCHEMA_VERSION = 4;

export async function createPostgresAgentCheckpointer(pool: Pool, schema = "public") {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Agent checkpoint schema 名称无效");
  const tables = ["checkpoint_migrations", "checkpoints", "checkpoint_blobs", "checkpoint_writes"];
  const existing = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
    WHERE table_schema=$1 AND table_name=ANY($2::text[])`, [schema, tables]);
  if (existing.rowCount !== tables.length) {
    throw new Error("Agent checkpoint schema 尚未由 Drizzle migration 初始化");
  }
  const version = await pool.query<{ version: number | null }>(
    `SELECT MAX(v)::integer AS version FROM "${schema}"."checkpoint_migrations"`,
  );
  if (version.rows[0]?.version !== LANGGRAPH_POSTGRES_SCHEMA_VERSION) {
    throw new Error(`Agent checkpoint schema 版本不匹配：需要 ${LANGGRAPH_POSTGRES_SCHEMA_VERSION}`);
  }
  return new PostgresSaver(pool, undefined, { schema });
}
