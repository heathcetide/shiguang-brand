import type { PreparedMeal } from "@dietdigidose/contracts";
import { mergePreparedMeals } from "./preparedMealState";
const batch = { id: "batch",version: 2,remaining_servings: 1,allocations: [{ id: "old" }] } as PreparedMeal;
test("an authoritative refresh can release allocations without changing the physical batch version", () => {
  const refreshed = { ...batch,allocations: [] };
  expect(mergePreparedMeals([batch],[refreshed],true)[0].allocations).toEqual([]);
  expect(mergePreparedMeals([batch],[refreshed])[0]).toBe(batch);
  expect(mergePreparedMeals([batch],[{ ...refreshed,version: 1 }],true)[0]).toBe(batch);
});
