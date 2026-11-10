import { EMPTY_FORM, profileToForm, profileUpdate } from "./form";

test("absent profile values never become guessed health data", () => {
  const form = profileToForm({ version: 1 });
  expect(form.age).toBe(""); expect(form.weight).toBe(""); expect(form.calories_kcal).toBe(""); expect(form.activity_level).toBe("");
  expect(profileUpdate("body", { version: 1, initial: form, form })).toBeNull();
});
test("current weight projection is presented without rewriting an unchanged measurement", () => {
  const form = profileToForm({ weight: 80, currentMeasurements: { weight: { value: 75, recordedDate: "2026-09-01", source: "log" } } });
  expect(form.weight).toBe("75"); expect(profileUpdate("body", { version: 1, initial: form, form: { ...form, height: "170" } })).toEqual({ version: 1, height: 170 });
});
test("saving nutrition explicitly confirms an existing calorie value", () => {
  const form = { ...EMPTY_FORM, calories_kcal: "2000" };
  expect(profileUpdate("nutrition", { version: 3, initial: form, form })).toEqual({ version: 3, nutrition_targets: { calories_kcal: 2000 } });
});
test("kitchen clears only the touched value and never sends body data", () => {
  const initial = { ...EMPTY_FORM, age: "25", servings: "2", kitchen: { servings: 2, meal_time_minutes: 20 } };
  expect(profileUpdate("kitchen", { version: 4, initial, form: { ...initial, servings: "", age: "30" } })).toEqual({ version: 4, kitchen_constraints: { servings: null } });
});
