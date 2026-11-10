import { formatInventoryQuantity, getInventoryStorageDisplay, groupInventoryByStorage } from "./inventory";

test.each(["冷藏", "冷冻", "常温"])("keeps explicit storage %s", location => {
  expect(getInventoryStorageDisplay(location)).toBe(location);
});

test.each(["", null, undefined, "未知", "柜子", " 冷藏 "])("marks unconfirmed storage %s without guessing", location => {
  expect(getInventoryStorageDisplay(location)).toBe("位置待确认");
});

test("groups every record exactly once without mutating stored values", () => {
  const locations = ["冷藏", "冷冻", "常温", "", null, undefined, "未知", "柜子"];
  const items = locations.map((storage_location, id) => Object.freeze({ id, storage_location }));
  const groups = groupInventoryByStorage(items);
  expect(Object.values(groups).map(group => group.length)).toEqual([1, 1, 1, 5]);
  const grouped = Object.values(groups).flat();
  expect(grouped).toHaveLength(items.length);
  expect(new Set(grouped).size).toBe(items.length);
  expect(items.map(item => item.storage_location)).toEqual(locations);
});

test.each(["", "  ", null, undefined])("displays unknown quantity %s without inventing a serving", quantity => {
  expect(formatInventoryQuantity(quantity)).toBe("数量未知");
});

test.each(["2个", "0", "0份", "数量未知"])("preserves recorded quantity %s", quantity => {
  expect(formatInventoryQuantity(quantity)).toBe(quantity);
});
