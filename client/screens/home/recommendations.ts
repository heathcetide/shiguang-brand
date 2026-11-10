export const getRecommendationPeriod = (hour: number) => {
  if (hour >= 11 && hour < 14) return "午间";
  if (hour >= 14 && hour < 18) return "下午茶";
  if (hour >= 18 && hour < 22) return "晚间";
  if (hour >= 22 || hour < 5) return "深夜";
  return "晨间";
};

const NON_FOOD_RECOMMENDATION_PATTERN = /记录|添加食材|完善资料|补水|饮水|查看|检查|处理/;

export function formatRecommendationMetric(card: Record<string, unknown>) {
  if (typeof card.metric === "string" && card.metric.trim()) return card.metric.trim();

  const calories = card.calories == null || card.calories === "" ? null : Number(card.calories);
  const searchableText = `${String(card.title || "")} ${String(card.tag || "")} ${String(card.desc || "")}`;
  if (NON_FOOD_RECOMMENDATION_PATTERN.test(searchableText) && (calories == null || calories <= 1)) return "查看建议";
  return calories != null && Number.isFinite(calories) && calories >= 0 ? `${calories} kcal` : "营养待补全";
}
