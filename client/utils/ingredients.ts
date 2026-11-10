const ALIASES: Record<string, string> = {
  西红柿: "番茄",
  圣女果: "番茄",
  小番茄: "番茄",
  青花菜: "西兰花",
  马铃薯: "土豆",
  番薯: "红薯",
  地瓜: "红薯",
  牛油果: "鳄梨",
};

export const normalizeIngredientName = (value: string) => {
  let normalized = value
    .toLocaleLowerCase()
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/\d+(?:\.\d+)?\s*(?:kg|千克|ml|毫升|[g克升个只颗片份盒包根勺])/gi, "")
    .replace(/新鲜|有机|优质|原切|水培|冷冻|冷藏/g, "")
    .replace(/[\s·、，,。()（）/\\_-]/g, "");
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    normalized = normalized.replaceAll(alias, canonical);
  }
  return normalized;
};

export const ingredientNamesMatch = (left: string, right: string) => {
  const normalizedLeft = normalizeIngredientName(left);
  const normalizedRight = normalizeIngredientName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
};
