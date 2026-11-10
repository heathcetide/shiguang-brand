import { formatRecommendationMetric, getRecommendationPeriod } from "./recommendations";

describe("home recommendation presentation", () => {
  it("maps hours to the expected recommendation periods", () => {
    expect(getRecommendationPeriod(8)).toBe("晨间");
    expect(getRecommendationPeriod(12)).toBe("午间");
    expect(getRecommendationPeriod(16)).toBe("下午茶");
    expect(getRecommendationPeriod(20)).toBe("晚间");
    expect(getRecommendationPeriod(23)).toBe("深夜");
  });

  it("prefers a semantic metric supplied by the server", () => {
    expect(formatRecommendationMetric({ title: "补水", metric: "还差 600 ml", calories: 1 })).toBe("还差 600 ml");
  });

  it("does not present legacy action cards as one kilocalorie", () => {
    expect(formatRecommendationMetric({ title: "记录一餐", tag: "待办", desc: "补全记录", calories: 1 })).toBe("查看建议");
  });

  it("keeps real food calorie values", () => {
    expect(formatRecommendationMetric({ title: "燕麦早餐", tag: "早餐", desc: "均衡搭配", calories: 320 })).toBe("320 kcal");
  });
});

test("food cards preserve unknown nutrition and legitimate zero", () => {
  expect(formatRecommendationMetric({ title: "蒸蛋", calories: null })).toBe("营养待补全");
  expect(formatRecommendationMetric({ title: "清茶", calories: 0 })).toBe("0 kcal");
});
