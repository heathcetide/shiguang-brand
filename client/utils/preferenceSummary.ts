import type { KitchenPreferences } from "@dietdigidose/contracts";

/** A conservative local parser: unsupported details remain in the editable transcript. */
export function summarizeMealPreferences(text: string): { preferences: KitchenPreferences; labels: string[] } {
  const preferences: KitchenPreferences = {};
  const labels: string[] = [];
  const numbers: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  // Questions, quoted examples and corrections need manual review rather than a guessed setting.
  text = (text.replace(/[“「『"][^”」』"]*[”」』"]/g, "").match(/[^，,。；;！？!?\n]+[，,。；;！？!?\n]?/g) ?? [])
    .filter(clause => !/[？?吗么]|如果|假如|比如|例如|不是|没说|没有说|不确定|不知道|是否|能否|能不能|可不可以|有没有|要不要/.test(clause)).join("，");
  const people = text.match(/(?:我们|共|给)?\s*(-?\d+(?:\.\d+)?|[负零〇一二两三四五六七八九十百千万亿点]+)\s*个?人/);
  if (people && !/(?:不是|不要|别|不按).{0,4}[\d一二两三四五六七八九十].{0,2}人/.test(text)) {
    const value = numbers[people[1]] ?? Number(people[1]);
    if (Number.isInteger(value) && value >= 1 && value <= 30) { preferences.servings = value; labels.push(`${value} 人用餐`); }
  }
  const duration = text.match(/(-?\d+(?:\.\d+)?)\s*分钟/);
  const minutes = duration ? Number(duration[1]) : text.includes("半小时") ? 30 : null;
  if (minutes !== null && Number.isInteger(minutes) && minutes >= 5 && minutes <= 300) { preferences.meal_time_minutes = minutes; labels.push(`做饭时间 ${minutes} 分钟`); }
  if (/不吃辣|不要辣|不能吃辣|不可以吃辣/.test(text) && !/(?:不是|没有说|没说).{0,4}(?:不吃辣|不要辣|不能吃辣|不可以吃辣)/.test(text)) {
    preferences.avoid_spicy = true; labels.push("不吃辣");
  }
  if (!preferences.avoid_spicy && /可以吃辣|能吃辣|吃辣没问题/.test(text)) {
    preferences.avoid_spicy = false; labels.push("可以吃辣");
  }
  const meals = [
    ["breakfast", "早餐"], ["lunch", "午饭"], ["dinner", "晚饭"], ["snack", "加餐"],
  ] as const;
  const usual = text.match(/(?:平时|通常|常用|以后)都?(?:吃|做|安排)?([^，]+)/)?.[1];
  if (usual && !/不|别/.test(usual)) {
    const selected = meals.filter(([, label]) => usual.includes(label) || (label === "午饭" && usual.includes("午餐")) || (label === "晚饭" && usual.includes("晚餐")));
    if (selected.length) { preferences.usual_meals = selected.map(([key]) => key); labels.push(`常用餐次：${selected.map(([, label]) => label).join("、")}`); }
  }
  const locations = [["home", "家"], ["work", "公司"], ["school", "学校"]] as const;
  const location = locations.filter(([, label]) => new RegExp(`(?:在|到)${label}(?:里)?(?:吃|用餐)`).test(text));
  if (location.length === 1 && !/(?:不在|不到|别在|不要在)(?:家|公司|学校)/.test(text)) {
    preferences.eating_location = location[0][0]; labels.push(`用餐地点：${location[0][1]}`);
  }
  const conditions = [
    { key: "carry_meals", yes: /(?:需要|要|会|每天)带饭/, no: /(?:不带饭|不需要带饭|不用带饭|不要带饭|不会带饭)/, positive: "需要带饭", negative: "不带饭" },
    { key: "refrigeration_available", yes: /(?:可以|能|可|有条件)冷藏|有冰箱/, no: /(?:不能|无法|不可|不可以|没法)冷藏|没有冰箱|没冰箱/, positive: "可以冷藏", negative: "不能冷藏" },
    { key: "reheating_available", yes: /(?:可以|能|可|有条件)加热|有微波炉/, no: /(?:不能|无法|不可|不可以|没法)加热|没有微波炉|没微波炉/, positive: "可以加热", negative: "不能加热" },
  ] as const;
  for (const condition of conditions) {
    const negative = condition.no.test(text);
    // A negative phrase often contains the positive substring; it takes precedence.
    if (negative || condition.yes.test(text)) {
      preferences[condition.key] = !negative;
      labels.push(negative ? condition.negative : condition.positive);
    }
  }
  const budget = text.match(/(?:每餐|一餐)?预算(?:是|为|控制在|不超过)?\s*(\d+(?:\.\d{1,2})?)\s*元/);
  if (budget && Number(budget[1]) <= 100_000 && !/(?:不设|没有|取消)预算/.test(text)) {
    preferences.budget_per_meal = Number(budget[1]); labels.push(`每餐预算 ${Number(budget[1])} 元`);
  }
  const levels = [
    ["beginner", /(?:做饭|厨艺|烹饪)(?:水平)?是?(?:新手|初学)|不会做饭/, "做饭新手"],
    ["intermediate", /(?:做饭|厨艺|烹饪)(?:水平)?是?(?:一般|中等|熟练)/, "做饭熟练"],
    ["advanced", /(?:做饭|厨艺|烹饪)(?:水平)?是?(?:进阶|高级)/, "做饭进阶"],
  ] as const;
  const level = levels.filter(([, pattern]) => pattern.test(text));
  if (level.length === 1) { preferences.cooking_level = level[0][0]; labels.push(level[0][2]); }
  const frequencies = [
    ["rarely", /很少(?:外食|在外面吃)|很少吃外卖/, "很少外食"],
    ["sometimes", /偶尔(?:外食|在外面吃)|偶尔吃外卖/, "偶尔外食"],
    ["often", /经常(?:外食|在外面吃)|经常吃外卖/, "经常外食"],
  ] as const;
  const frequency = frequencies.filter(([, pattern]) => pattern.test(text));
  if (frequency.length === 1) { preferences.eating_out_frequency = frequency[0][0]; labels.push(frequency[0][2]); }
  return { preferences, labels };
}
