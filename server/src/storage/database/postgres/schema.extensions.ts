import { sql } from "drizzle-orm";
import { customType, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { agentRuns } from "./schema.generated.ts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// These tables follow @langchain/langgraph-checkpoint-postgres 1.0.5 exactly.
// They live in Drizzle so production startup never mutates the schema implicitly.
export const checkpointMigrations = pgTable("checkpoint_migrations", {
  v: integer("v").primaryKey().notNull(),
});

export const checkpoints = pgTable("checkpoints", {
  thread_id: text("thread_id").notNull()
    .references(() => agentRuns.checkpoint_thread_id, { onDelete: "cascade" }),
  checkpoint_ns: text("checkpoint_ns").notNull().default(""),
  checkpoint_id: text("checkpoint_id").notNull(),
  parent_checkpoint_id: text("parent_checkpoint_id"),
  type: text("type"),
  checkpoint: jsonb("checkpoint").notNull(),
  metadata: jsonb("metadata").notNull().default(sql.raw("'{}'::jsonb")),
}, (table) => [
  primaryKey({ name: "checkpoints_pkey", columns: [table.thread_id, table.checkpoint_ns, table.checkpoint_id] }),
]);

export const checkpointBlobs = pgTable("checkpoint_blobs", {
  thread_id: text("thread_id").notNull()
    .references(() => agentRuns.checkpoint_thread_id, { onDelete: "cascade" }),
  checkpoint_ns: text("checkpoint_ns").notNull().default(""),
  channel: text("channel").notNull(),
  version: text("version").notNull(),
  type: text("type").notNull(),
  blob: bytea("blob"),
}, (table) => [
  primaryKey({ name: "checkpoint_blobs_pkey", columns: [table.thread_id, table.checkpoint_ns, table.channel, table.version] }),
]);

export const checkpointWrites = pgTable("checkpoint_writes", {
  thread_id: text("thread_id").notNull()
    .references(() => agentRuns.checkpoint_thread_id, { onDelete: "cascade" }),
  checkpoint_ns: text("checkpoint_ns").notNull().default(""),
  checkpoint_id: text("checkpoint_id").notNull(),
  task_id: text("task_id").notNull(),
  idx: integer("idx").notNull(),
  channel: text("channel").notNull(),
  type: text("type"),
  blob: bytea("blob").notNull(),
}, (table) => [
  primaryKey({
    name: "checkpoint_writes_pkey",
    columns: [table.thread_id, table.checkpoint_ns, table.checkpoint_id, table.task_id, table.idx],
  }),
]);
