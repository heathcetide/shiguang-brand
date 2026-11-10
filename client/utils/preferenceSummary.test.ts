import { summarizeMealPreferences } from "./preferenceSummary";

test("extracts only supported meal details for review", () => {
  expect(summarizeMealPreferences("我们两个人，20分钟，不吃辣，花生过敏").preferences).toEqual({ servings: 2, meal_time_minutes: 20, avoid_spicy: true });
});
test("does not infer missing personal data or negate a denial", () => {
  expect(summarizeMealPreferences("不知道体重，也没说不吃辣").preferences).toEqual({});
  expect(summarizeMealPreferences("不是两个人").preferences).toEqual({});
});

test("does not extract a valid suffix from unsupported numeric preferences", () => {
  for (const text of ["120人", "1.5人", "1200分钟", "1.5分钟", "-2人", "-20分钟", "十二人", "二十人", "一百零二个人", "一点五人", "负二人"]) {
    expect(summarizeMealPreferences(text).preferences).toEqual({});
  }
  expect(summarizeMealPreferences("我们20人，120分钟").preferences).toEqual({
    servings: 20, meal_time_minutes: 120,
  });
});

test("summarizes explicit regular meals, location and storage conditions", () => {
  const summary = summarizeMealPreferences("以后通常吃午餐和晚餐，在公司吃，需要带饭，有冰箱，可以加热");
  expect(summary.preferences).toEqual({ usual_meals: ["lunch", "dinner"], eating_location: "work", carry_meals: true, refrigeration_available: true, reheating_available: true });
  expect(summary.labels).toEqual(["常用餐次：午饭、晚饭", "用餐地点：公司", "需要带饭", "可以冷藏", "可以加热"]);
});
test("does not turn unavailable storage or reheating into an available facility", () => {
  expect(summarizeMealPreferences("不需要带饭，不能冷藏，没有微波炉").preferences).toEqual({ carry_meals: false, refrigeration_available: false, reheating_available: false });
});
test("explicit cannot and will-not phrases do not match their positive substrings", () => {
  expect(summarizeMealPreferences("不可以吃辣，不会带饭，不可以冷藏，不可以加热").preferences).toEqual({
    avoid_spicy: true, carry_meals: false, refrigeration_available: false, reheating_available: false,
  });
});
test("leaves questions, examples, unknowns and negated corrections for manual review", () => {
  for (const text of ["不知道能不能冷藏", "能不能加热", "需要带饭？", "有冰箱?", "不确定有没有微波炉", "如果有冰箱", "可以加热吗", "没说需要带饭", "不是20分钟", "比如两个人", "“有冰箱”", "不在公司吃"]) {
    expect(summarizeMealPreferences(text).preferences).toEqual({});
  }
  expect(summarizeMealPreferences("今天做今晚和明天午饭").preferences.usual_meals).toBeUndefined();
});

test("summarizes every supported kitchen preference without inventing health restrictions", () => {
  const result = summarizeMealPreferences("两个人，20分钟，不吃辣，预算30元，做饭新手，偶尔外食，平时吃午餐和晚餐，在公司吃，需要带饭，不能冷藏，没有微波炉，花生过敏");
  expect(result.preferences).toEqual({ servings: 2, meal_time_minutes: 20, avoid_spicy: true,
    budget_per_meal: 30, cooking_level: "beginner", eating_out_frequency: "sometimes",
    usual_meals: ["lunch", "dinner"], eating_location: "work", carry_meals: true,
    refrigeration_available: false, reheating_available: false });
  expect(result.labels).toHaveLength(11);
});
test("keeps ambiguous, negated and hypothetical new settings for manual review", () => {
  for (const text of ["不是做饭新手", "比如预算30元", "如果偶尔外食", "预算100001元", "做饭新手，做饭熟练", "很少外食，经常外食"]) {
    expect(summarizeMealPreferences(text).preferences).toEqual({});
  }
});


test("an explicit spicy preference can replace an earlier avoidance without guessing from silence", () => {
  expect(summarizeMealPreferences("我可以吃辣").preferences).toEqual({ avoid_spicy: false });
  expect(summarizeMealPreferences("我可以吃辣吗").preferences).toEqual({});
  expect(summarizeMealPreferences("不是能吃辣").preferences).toEqual({});
});
