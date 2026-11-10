import type { AgentArtifact } from "./types.js";

export type AgentSolutionCard = {
  id: string;
  schemeTag: string;
  title: string;
  ingredients: string;
  ingredientItems?: Array<{ name: string; amount: string }>;
  cookingTip: string;
  steps?: string[];
  macros: string;
  actionText: string;
  source: "ai";
};

type JsonRecord = Record<string, unknown>;

const TITLE_KEYS = ["title", "recipeName", "name", "菜名", "菜品", "方案名称", "食谱名称"];
const INGREDIENT_KEYS = ["ingredients", "ingredientItems", "所需食材", "食材", "材料", "用料"];
const STEPS_KEYS = ["steps", "制作步骤", "烹饪步骤", "做法", "recipeSteps"];
const TIP_KEYS = ["cookingTip", "tips", "关键技巧", "烹饪提示", "注意事项", "适合原因", "suitableReason"];
const NUTRITION_KEYS = ["macros", "estimatedNutrition", "estimated_nutrition", "预计营养", "营养", "营养估算"];
const STRUCTURAL_KEYS = new Set([
  "cards", "recipes", "meal_plan", "mealPlan", "plan", "方案", "推荐方案", "example_recipe", "exampleRecipe",
  ...INGREDIENT_KEYS, ...STEPS_KEYS, ...TIP_KEYS, ...NUTRITION_KEYS,
]);

const asRecord = (value: unknown): JsonRecord | undefined => (
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined
);

const firstValue = (record: JsonRecord, keys: string[]) => {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
};

const valueText = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join("、");
  const record = asRecord(value);
  if (!record) return "";
  return Object.entries(record)
    .map(([key, item]) => {
      const text = valueText(item);
      return text ? `${key}：${text}` : "";
    })
    .filter(Boolean)
    .join("；");
};

const splitSteps = (value: unknown): string[] | undefined => {
  const raw = Array.isArray(value) ? value.map(valueText) : typeof value === "string"
    ? value.split(/\n+|(?=\d+[.、）)]\s*)/u)
    : [];
  const steps = raw
    .map((step) => step.replace(/^\s*(?:步骤\s*)?\d+[.、）)]\s*/u, "").trim())
    .filter(Boolean);
  return steps.length ? steps : undefined;
};

const parseIngredientText = (text: string) => {
  const cleaned = text.replace(/^[-•·]\s*/u, "").trim();
  if (!cleaned) return undefined;
  const match = cleaned.match(/^(.+?)(?:[：:]|\s{1,})(约?\s*\d+(?:\.\d+)?\s*(?:克|g|kg|千克|毫升|ml|升|个|颗|只|片|块|勺|茶匙|汤匙|份|根|把|瓣|枚|盒|袋)|适量|少许|若干)$/iu);
  return match
    ? { name: match[1].trim(), amount: match[2].replace(/\s+/gu, "") }
    : { name: cleaned, amount: "适量" };
};

const ingredientItems = (value: unknown): Array<{ name: string; amount: string }> | undefined => {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n、，；;]+/u)
      : [];
  const items = values.flatMap((item) => {
    if (typeof item === "string") {
      const parsed = parseIngredientText(item);
      return parsed ? [parsed] : [];
    }
    const record = asRecord(item);
    if (!record) return [];
    const name = valueText(firstValue(record, ["name", "foodName", "ingredient", "食材", "名称"]));
    if (!name) return [];
    const amount = valueText(firstValue(record, ["amount", "quantity", "用量", "数量", "分量"])) || "适量";
    return [{ name, amount }];
  });
  return items.length ? items.slice(0, 30) : undefined;
};

const meaningfulParentTitle = (parentKey: string | undefined) => {
  if (!parentKey || STRUCTURAL_KEYS.has(parentKey)) return "";
  return parentKey.replace(/[_-]+/gu, " ").trim();
};

const schemeTag = (parentKey: string | undefined, artifact: AgentArtifact) => {
  const parent = meaningfulParentTitle(parentKey);
  if (/^(主方案|备选方案|方案\s*[A-Z一二三四五六七八九十0-9]*)/iu.test(parent)) {
    return parent.split(/[：:]/u)[0].slice(0, 8);
  }
  return artifact.type === "meal_plan" ? "餐单建议" : "食语推荐";
};

const createCard = (
  runId: string,
  artifact: AgentArtifact,
  record: JsonRecord,
  parentKey: string | undefined,
  index: number,
): AgentSolutionCard | undefined => {
  const ingredientsValue = firstValue(record, INGREDIENT_KEYS);
  const stepsValue = firstValue(record, STEPS_KEYS);
  const tipsValue = firstValue(record, TIP_KEYS);
  const nutritionValue = firstValue(record, NUTRITION_KEYS);
  const directTitle = valueText(firstValue(record, TITLE_KEYS));
  const title = directTitle || meaningfulParentTitle(parentKey);
  const hasRecipeDetails = Boolean(valueText(ingredientsValue) || valueText(stepsValue));
  if (!title || !hasRecipeDetails) return undefined;

  const ingredients = valueText(ingredientsValue);
  const steps = splitSteps(stepsValue);
  const tip = valueText(tipsValue);
  const macros = valueText(nutritionValue);
  return {
    id: `${runId}:solution:${index}`,
    schemeTag: schemeTag(parentKey, artifact),
    title: title.slice(0, 80),
    ingredients: ingredients || "食材以当前库存和实际份量为准",
    ingredientItems: ingredientItems(ingredientsValue),
    cookingTip: tip || "按实际食材与厨具调整火候，肉蛋类食材需彻底熟透。",
    steps,
    macros: macros || "营养数据为估算值，请按实际用量调整",
    actionText: `请补充【${title.slice(0, 80)}】的完整食材用量、制作步骤和烹饪时间。`,
    source: "ai",
  };
};

export const buildAgentSolutionCards = (
  runId: string,
  artifacts: AgentArtifact[] | undefined,
): AgentSolutionCard[] => {
  const cards: AgentSolutionCard[] = [];
  const seen = new Set<string>();

  const visit = (artifact: AgentArtifact, value: unknown, parentKey?: string, depth = 0) => {
    if (cards.length >= 6 || depth > 5) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(artifact, item, parentKey || `方案${index + 1}`, depth + 1));
      return;
    }
    const record = asRecord(value);
    if (!record) return;

    const card = createCard(runId, artifact, record, parentKey, cards.length);
    if (card) {
      const key = card.title.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        cards.push(card);
      }
    }
    Object.entries(record).forEach(([key, child]) => {
      if (child !== null && typeof child === "object") visit(artifact, child, key, depth + 1);
    });
  };

  for (const artifact of artifacts || []) {
    if (artifact.type !== "recipes" && artifact.type !== "meal_plan") continue;
    visit(artifact, artifact.data, artifact.title);
    if (cards.length >= 6) break;
  }
  return cards;
};
