import { formatToolContext, planTools } from "./harness";
import type { AgentToolDefinition } from "./types";

const fakeTools: AgentToolDefinition[] = [
  {
    name: "list_inventory",
    description: "inventory",
    parameters: {},
    hints: ["库存", "冰箱"],
    execute: async () => [],
  },
  {
    name: "search_recipes",
    description: "recipes",
    parameters: {},
    hints: ["菜谱", "推荐"],
    execute: async () => [],
  },
  {
    name: "get_health_profile",
    description: "health",
    parameters: {},
    hints: ["过敏"],
    execute: async () => ({}),
  },
];

test("planTools matches inventory and recipe intents", () => {
  const inventory = planTools("冰箱里有什么可以做晚饭？", fakeTools);
  expect(inventory.map((tool) => tool.name)).toEqual(expect.arrayContaining(["list_inventory"]));

  const recipes = planTools("推荐一道减脂菜谱", fakeTools);
  expect(recipes.some((tool) => tool.name === "search_recipes")).toBe(true);
});

test("formatToolContext serializes ok and error rows", () => {
  const text = formatToolContext([
    { id: "1", name: "list_inventory", ok: true, result: [{ name: "番茄" }] },
    { id: "2", name: "list_shopping", ok: false, error: "offline" },
  ]);
  expect(text).toContain("[tool:list_inventory]");
  expect(text).toContain("番茄");
  expect(text).toContain("ERROR offline");
});
