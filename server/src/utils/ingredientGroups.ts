export const INGREDIENT_GROUPS = ['主料', '辅料', '调味料'] as const;
export type IngredientGroup = typeof INGREDIENT_GROUPS[number];

export type GroupableIngredient = {
  name: string;
  amount: string;
  group?: string;
};

const SEASONING_PATTERN = /盐|糖|(?:^油$|食用油|植物油|花生油|菜籽油|橄榄油|香油|麻油|猪油)$|生抽|老抽|酱油|豉油|醋|料酒|蚝油|鱼露|味精|鸡精|豆瓣酱|甜面酱|辣椒酱|番茄酱|沙拉酱|胡椒|孜然|五香粉|十三香|咖喱粉|辣椒粉|蜂蜜|味噌|酱$/;
const AUXILIARY_PATTERN = /葱|姜|蒜|辣椒|香菜|芝麻|花椒|八角|桂皮|香叶|薄荷|罗勒|柠檬皮|橙皮|淀粉|泡打粉|酵母|水$/;
const PRIMARY_PATTERN = /肉|排骨|鸡|鸭|鹅|鱼|虾|蟹|贝|蛋|豆腐|豆皮|腐竹|米|面|粉|饭|燕麦|吐司|面包|土豆|番茄|花菜|白菜|菠菜|生菜|茄子|黄瓜|南瓜|冬瓜|萝卜|芹菜|豆角|蘑菇|香菇|玉米|牛奶|酸奶/;

export function normalizeIngredientGroup(value: unknown): IngredientGroup | null {
  const group = String(value || '').trim();
  return INGREDIENT_GROUPS.includes(group as IngredientGroup) ? group as IngredientGroup : null;
}

function amountInGrams(amount: string): number {
  const match = amount.match(/(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g|毫升|ml|升|l|斤|两)(?![a-z])/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (/千克|公斤|kg|升|l/i.test(match[2])) return value * 1000;
  if (match[2] === '斤') return value * 500;
  if (match[2] === '两') return value * 50;
  return value;
}

export function inferIngredientGroup(
  ingredient: Pick<GroupableIngredient, 'name' | 'amount'>,
  index: number,
  recipeTitle = '',
): IngredientGroup {
  const name = ingredient.name.trim();
  const amount = ingredient.amount.trim();
  if (SEASONING_PATTERN.test(name)) return '调味料';
  if (amountInGrams(amount) >= 80) return '主料';
  if (name.length >= 2 && recipeTitle.includes(name)) return '主料';
  if (AUXILIARY_PATTERN.test(name)) return '辅料';
  if (PRIMARY_PATTERN.test(name)) return '主料';
  return index < 2 ? '主料' : '辅料';
}

export function ensureIngredientGroups<T extends GroupableIngredient>(ingredients: T[], recipeTitle = ''): Array<T & { group: IngredientGroup }> {
  return ingredients.map((ingredient, index) => ({
    ...ingredient,
    group: normalizeIngredientGroup(ingredient.group) || inferIngredientGroup(ingredient, index, recipeTitle),
  }));
}
