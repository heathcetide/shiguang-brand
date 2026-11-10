import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const connectionString = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL)?.trim();
if (!connectionString) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required");
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
const pool = new Pool({ connectionString, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("PostgreSQL schema is ready");
} finally {
  await pool.end();
}
