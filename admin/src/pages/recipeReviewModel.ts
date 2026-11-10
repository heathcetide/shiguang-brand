// SQLite returns JSON text; PostgreSQL jsonb arrives as an already decoded array.
export function parseRecipeArray<T>(value: string | T[] | null | undefined): T[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value || '[]') : value ?? [];
  if (!Array.isArray(parsed)) throw new Error('Expected a recipe array');
  return parsed as T[];
}

const QUALITY_ISSUE_LABELS: Record<string, string> = {
  category_nutrition_fallback: '使用分类固定营养兜底',
  implausible_cook_time: '烹饪时间明显不合理',
  instruction_as_ingredient: '步骤被误识别为食材',
  truncated_ingredient: '食材文本疑似截断',
  insufficient_structure: '食材或步骤结构不完整',
  nutrition_unknown: '营养数据尚未核验',
  cooking_not_reviewed: '烹饪内容尚未审核',
};

export function qualityIssueText(recipe: { quality_issues_json?: string | string[] | null }) {
  try {
    return parseRecipeArray(recipe.quality_issues_json).map((issue) => {
      if (typeof issue !== 'string') throw new Error('Expected an issue code');
      return QUALITY_ISSUE_LABELS[issue] || issue;
    }).join('；');
  } catch {
    return '质量问题记录无法解析';
  }
}

export function recipeStatusText(status?: string) {
  return status === 'pending' ? '待审核' : status === 'approved' ? '已通过' : status === 'rejected' ? '已驳回' : '状态未知';
}

/** Imported source text is evidence, never an executable URL. */
export function safeRecipeSourceUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Blank fields in an edit mean no new nutritional evidence, not measured zero.
export function recipeNutritionPayload(form: Record<'calories' | 'protein' | 'carbs' | 'fat', string>, editing: boolean) {
  return Object.fromEntries((['calories', 'protein', 'carbs', 'fat'] as const).flatMap(key =>
    editing && !form[key].trim() ? [] : [[key, Number(form[key]) || 0]]));
}
