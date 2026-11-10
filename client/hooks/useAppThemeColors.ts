import { useCSSVariable } from "uniwind";

const COLOR_KEYS = [
  "brand",
  "brand-fill",
  "brand-strong",
  "brand-soft",
  "on-brand",
  "canvas",
  "ink",
  "copy-muted",
  "line",
  "highlight",
  "critical",
  "critical-fill",
  "on-critical",
  "warm",
  "warm-fill",
  "warm-soft",
  "info",
  "info-fill",
  "info-soft",
  "surface",
  "background-secondary",
  "success",
  "success-fill",
  "on-success",
  "danger-soft",
] as const;

type ColorKey = (typeof COLOR_KEYS)[number];
type AppThemeColors = Record<ColorKey, string>;

export function useAppThemeColors(): AppThemeColors {
  const values = useCSSVariable(
    COLOR_KEYS.map((key) => `--color-${key}`),
  ) as string[];

  return Object.fromEntries(
    COLOR_KEYS.map((key, index) => [key, values[index]]),
  ) as AppThemeColors;
}
