const store: Record<string, string> = {};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => store[key] || null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    clear: jest.fn(async () => {
      for (const k of Object.keys(store)) delete store[k];
    }),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { addInventoryLog, clearInventoryHistory, getInventoryHistory } from "../inventoryHistory";

describe("inventoryHistory", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test("adds log entries and retrieves them in reverse chronological order", async () => {
    const userId = 42;
    await addInventoryLog({ foodName: "番茄", action: "add", quantity: "2个", storageLocation: "冷藏" }, userId);
    await addInventoryLog({ foodName: "牛奶", action: "consume", quantity: "1盒", storageLocation: "冷藏" }, userId);

    const history = await getInventoryHistory(userId);
    expect(history.length).toBe(2);
    expect(history[0].foodName).toBe("牛奶");
    expect(history[0].action).toBe("consume");
    expect(history[1].foodName).toBe("番茄");
    expect(history[1].action).toBe("add");
  });

  test("clears history for specific user", async () => {
    const userId = 42;
    await addInventoryLog({ foodName: "猪肉", action: "add", quantity: "500g", storageLocation: "冷冻" }, userId);
    await clearInventoryHistory(userId);
    const history = await getInventoryHistory(userId);
    expect(history).toEqual([]);
  });
});
