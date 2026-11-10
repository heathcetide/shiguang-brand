export function getRecipeNutritionPresentation(isEstimated: boolean, basis?: string) {
  if (basis === 'unknown') return { prefix: '', title: '营养待补全', disclosure: '原料、用量和对应的营养记录尚未全部匹配，暂不计算；缺失不代表含量为零。' };
  return isEstimated
    ? {
        prefix: "约",
        title: "营养估算",
        disclosure: "营养数据为估算值，实际结果会因食材品牌、份量与烹饪方式而变化。",
      }
    : { prefix: "", title: "营养成分", disclosure: null };
}
