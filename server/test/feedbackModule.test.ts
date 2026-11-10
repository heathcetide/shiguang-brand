import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { FeedbackRepository } from "../src/modules/feedback/repository.js";
import { FeedbackService } from "../src/modules/feedback/service.js";
import { SqliteFeedbackRepository } from "../src/modules/feedback/sqliteRepository.js";

describe("feedback module", () => {
  test("keeps the service independent of the database driver", async () => {
    const writes: Array<{ userId: number; content: string }> = [];
    const repository: FeedbackRepository = {
      list: async () => [], detail: async () => null, reply: async () => {},
      create: async (userId, input) => {
        writes.push({ userId, content: input.content });
        return 91;
      },
    };
    const service = new FeedbackService(repository);

    assert.deepEqual(await service.create(42, {
      category: "suggestion",
      content: "希望增加批量录入功能",
      context: { page: "inventory" },
    }), { id: 91, status: "received" });
    assert.deepEqual(writes, [{ userId: 42, content: "希望增加批量录入功能" }]);
  });

  test("SQLite adapter preserves structured context and user ownership", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE user_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          context_json TEXT, status TEXT DEFAULT 'received', request_key TEXT, version INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
        )
      `);
      const repository = new SqliteFeedbackRepository(database);
      const id = await repository.create(7, {
        category: "issue",
        content: "烹饪页无法继续",
        context: { page: "cooking", recipeId: 23, recipeTitle: "番茄炒蛋" },
      });
      const row = database.prepare("SELECT * FROM user_feedback WHERE id = ?").get(id) as {
        user_id: number;
        category: string;
        content: string;
        context_json: string;
      };
      assert.equal(row.user_id, 7);
      assert.equal(row.category, "issue");
      assert.equal(row.content, "烹饪页无法继续");
      assert.deepEqual(JSON.parse(row.context_json), {
        page: "cooking",
        recipeId: 23,
        recipeTitle: "番茄炒蛋",
      });
    } finally {
      database.close();
    }
  });
});
