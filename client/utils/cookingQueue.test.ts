jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCookingQueue, needsCookingQueueServerMigration, markCookingQueueServerMigrated, normalizeCookingQueue, mergeCookingQueueRuntime, saveCookingQueue } from "./cookingQueue";

describe("cooking queue", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset().mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it("normalizes valid recipes and removes duplicates", () => {
    expect(normalizeCookingQueue([
      { recipeId: 12, title: " 番茄炒蛋 ", cookTime: 10, calories: 260, difficulty: "简单", addedAt: 1 },
      { recipeId: 12, title: "重复菜谱" },
      { recipeId: 0, title: "无效菜谱" },
    ])).toEqual([expect.objectContaining({ recipeId: 12, title: "番茄炒蛋", ingredients: [], preparedIngredientNames: [] })]);
  });

  it("normalizes prepared ingredients and preserves the saved queue order", async () => {
    const queue = [
      { recipeId: 1, title: "第一道", imageUrl: null, cookTime: 10, calories: 100, difficulty: "简单", addedAt: 1, ingredients: [], preparedIngredientNames: [" 葱 ", "葱"] },
      { recipeId: 2, title: "第二道", imageUrl: null, cookTime: 20, calories: 200, difficulty: "简单", addedAt: 2, ingredients: [], preparedIngredientNames: [] },
    ];
    expect(normalizeCookingQueue(queue)[0].preparedIngredientNames).toEqual(["葱"]);
    const items = await saveCookingQueue(101, [...queue].reverse());

    expect(items.map((item) => item.recipeId)).toEqual([2, 1]);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining(":user:101"),
      expect.stringContaining('"recipeId":2'),
    );
  });

  it("keeps legacy queue data readable and migration markers scoped to the account", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([{ recipeId: 12, title: "旧队列", reminderNotificationId: "old-reminder" }]));
    expect(await getCookingQueue(101)).toEqual([expect.objectContaining({ recipeId: 12, reminderNotificationId: "old-reminder" })]);
    expect(AsyncStorage.getItem).toHaveBeenLastCalledWith("@dietdigidose:cooking_queue:user:101");
    expect(await needsCookingQueueServerMigration(101)).toBe(true);
    await markCookingQueueServerMigrated(101);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith("@dietdigidose:cooking_queue_server_migrated:user:101", "1");
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("1");
    expect(await needsCookingQueueServerMigration(101)).toBe(false);
    expect(await needsCookingQueueServerMigration(null)).toBe(false);
  });
});


test("queue shadows preserve unknown and explicit zero across storage normalization", () => {
  for (const cookTime of [null, undefined, "", " ", -1, "unknown", Infinity, false, true, [], {}]) {
    expect(normalizeCookingQueue([{ recipeId: 1, title: "时间待核对", cookTime }])[0].cookTime).toBeNull();
  }
  expect(normalizeCookingQueue([{ recipeId: 1, title: "明确零", cookTime: 0 }])[0].cookTime).toBe(0);
  expect(normalizeCookingQueue([{ recipeId: 1, title: "明确分钟", cookTime: "10" }])[0].cookTime).toBe(10);
});


test("same recipe tasks retain separate identity and reminders across persisted shadows", async () => {
  const first = { recipeId: 8, title: "同菜谱第一餐", imageUrl: null, cookTime: 10, calories: 100, difficulty: "简单", addedAt: 1, ingredients: [], preparedIngredientNames: [], queueItemId: "task-a", reminderAt: 1000, reminderNotificationId: "notice-a" };
  const second = { ...first, queueItemId: "task-b", reminderAt: 2000, reminderNotificationId: "notice-b" };
  const saved = await saveCookingQueue(1, [first, second, first]);
  expect(saved.map(item => item.queueItemId)).toEqual(["task-a", "task-b"]);
  expect(JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1])).toHaveLength(2);
  const restored = mergeCookingQueueRuntime([{ id: "task-b", recipeId: 8, plannedAt: new Date(2000).toISOString() }, { id: "task-a", recipeId: 8, plannedAt: new Date(1000).toISOString() }], normalizeCookingQueue(JSON.parse(JSON.stringify(saved))));
  expect(restored.map(item => item.reminderNotificationId)).toEqual(["notice-b", "notice-a"]);
  expect(mergeCookingQueueRuntime([{ id: "task-a", recipeId: 8, plannedAt: new Date(3000).toISOString() }], saved)[0].reminderNotificationId).toBeUndefined();
});
test("legacy reminder recovery requires an unambiguous recipe and matching current date", () => {
  const legacy = normalizeCookingQueue([{ recipeId: 8, title: "旧提醒", reminderAt: 1000, reminderNotificationId: "old" }]);
  const first = { id: "task-a", recipeId: 8, plannedAt: new Date(1000).toISOString() };
  expect(mergeCookingQueueRuntime([first], legacy)[0].reminderNotificationId).toBe("old");
  expect(mergeCookingQueueRuntime([first, { ...first, id: "task-b" }], legacy).every(item => !item.reminderNotificationId)).toBe(true);
  expect(mergeCookingQueueRuntime([{ ...first, plannedAt: null }], legacy)[0].reminderNotificationId).toBeUndefined();
});
