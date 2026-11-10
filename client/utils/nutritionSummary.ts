// A known subtotal is not a complete total when any recorded value is missing.
export function summarizeNutrition(values: readonly (number | null | undefined)[]) {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    total: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    incomplete: known.length < values.length,
  };
}

export function formatNutritionSummary(summary: ReturnType<typeof summarizeNutrition>, unit: string) {
  // Limit display precision only; keep small values and the unrounded sum for calculations.
  return summary.total == null ? "未知" : `${summary.incomplete ? "已知 " : ""}${Number(summary.total.toPrecision(12))}${unit}`;
}
