import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { databaseDriver } from "../src/composition/runtime.js";

describe("database runtime composition", () => {
  it("keeps SQLite as the local-compatible default", () => {
    assert.equal(databaseDriver({}), "sqlite");
    assert.equal(databaseDriver({ DATABASE_DRIVER: " sqlite " }), "sqlite");
  });

  it("selects PostgreSQL only when explicitly configured", () => {
    assert.equal(databaseDriver({ DATABASE_DRIVER: "POSTGRESQL" }), "postgresql");
  });

  it("fails closed for misspelled database drivers", () => {
    assert.throws(() => databaseDriver({ DATABASE_DRIVER: "postgres" }), /DATABASE_DRIVER/);
  });
});
