/**
 * 从中文维基教科书的 Category:食譜 导入结构完整的菜谱。
 *
 * - 仅接收至少有 2 种食材和 2 个步骤的页面；
 * - 使用 MediaWiki pageid 幂等更新；
 * - 与其他来源按简繁统一后的标题去重；
 * - 固定到具体 oldid，并保存 CC BY-SA 4.0 署名信息；
 * - 不导入图片，因为 Wikimedia 图片需要逐文件核验许可证。
 *
 * 用法：
 *   pnpm --dir server import:wikibooks-recipes
 *   pnpm --dir server import:wikibooks-recipes -- --dry-run
 */
import { Converter } from 'opencc-js';
import { db, initDatabase } from '../src/storage/db.js';
import { assessRecipeQuality, type NutritionBasis, type RecipeQualityIssue, type RecipeQualityStatus } from '../src/services/recipeQuality.js';
import { findRecipeDuplicateCandidates, recipeContentFingerprint, validateRecipePublication } from '../src/services/contentGovernance.js';
import { beginImportBatch, contentSnapshot, finishImportBatch, trackImportMutation } from '../src/services/importGovernance.js';
import { setRecipeKitchenwareRequirements } from '../src/services/kitchenwareCapabilities.js';
import { ensureIngredientGroups, type IngredientGroup } from '../src/utils/ingredientGroups.js';

const API_URL = 'https://zh.wikibooks.org/w/api.php';
const SOURCE = 'wikibooks_zh';
const LICENSE = 'CC-BY-SA-4.0';
const CATEGORY = 'Category:食譜';
const USER_AGENT = 'DietDigiDose/1.0 (Chinese Wikibooks recipe importer)';
const dryRun = process.argv.includes('--dry-run');
const toSimplified = Converter({ from: 'tw', to: 'cn' });
let batchId: string | null = null;

type CategoryMember = { pageid: number; ns: number; title: string };
type WikiRevision = {
  revid: number;
  timestamp?: string;
  slots?: { main?: { content?: string } };
};
type WikiPage = {
  pageid: number;
  ns: number;
  title: string;
  revisions?: WikiRevision[];
};
type Ingredient = { name: string; amount: string; group?: IngredientGroup };
type NutrientFood = {
  name: string;
  calories_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
};
type ParsedRecipe = {
  externalId: string;
  title: string;
  description: string;
  cookTime: number;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  category: string;
  tags: string[];
  steps: string[];
  ingredients: Ingredient[];
  sourceUrl: string;
  revision: string;
  attribution: string;
  qualityStatus: RecipeQualityStatus;
  nutritionBasis: NutritionBasis;
  qualityIssues: RecipeQualityIssue[];
};

function requiredKitchenwareFor(recipe: Pick<ParsedRecipe, 'title' | 'steps'>) {
  const text = `${recipe.title} ${recipe.steps.join(' ')}`;
  const names = [
    ...(/空气炸锅/.test(text) ? ['空气炸锅'] : []),
    ...(/烤箱|烘烤|烘焙/.test(text) ? ['烤箱'] : []),
    ...(/蒸|蒸制/.test(text) ? ['蒸锅'] : []),
    ...(/炖|煮|汤|焯/.test(text) ? ['汤锅'] : []),
    ...(/炒|煎|爆/.test(text) ? ['炒锅'] : []),
    '菜刀',
  ];
  return [...new Set(names)];
}

const INGREDIENT_HEADINGS = [
  '食材', '材料', '原料', '用料', '配料', '所需材料', '使用材料', '必备原料', '主料',
];
const STEP_HEADINGS = [
  '做法', '制作方法', '操作', '制法', '作法', '作法步骤', '步骤', '烹调方法', '烹饪方法', '制作',
];

async function apiRequest(params: Record<string, string>): Promise<any> {
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', ...params })) {
    url.searchParams.set(key, value);
  }
  let lastError = '未知错误';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw new Error(`中文维基教科书请求失败：${lastError}`);
}

async function fetchPages(): Promise<WikiPage[]> {
  const categoryPayload = await apiRequest({
    list: 'categorymembers',
    cmtitle: CATEGORY,
    cmtype: 'page',
    cmlimit: 'max',
  }) as { query?: { categorymembers?: CategoryMember[] } };
  const members = categoryPayload.query?.categorymembers || [];
  const pages: WikiPage[] = [];
  for (let offset = 0; offset < members.length; offset += 50) {
    const batch = members.slice(offset, offset + 50);
    const payload = await apiRequest({
      prop: 'revisions',
      rvprop: 'ids|timestamp|content',
      rvslots: 'main',
      pageids: batch.map((page) => page.pageid).join('|'),
    }) as { query?: { pages?: WikiPage[] } };
    pages.push(...(payload.query?.pages || []));
    console.log(`已获取维基页面 ${Math.min(offset + batch.length, members.length)}/${members.length}`);
  }
  return pages;
}

function stripTemplates(value: string): string {
  let result = value;
  for (let i = 0; i < 5; i += 1) {
    const next = result.replace(/\{\{[^{}]*}}/g, '');
    if (next === result) break;
    result = next;
  }
  return result;
}

function cleanWikiText(value: string): string {
  return toSimplified(stripTemplates(value)
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^/>]*\/>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:File|Image|文件|图像):[^\]]+]]/gi, '')
    .replace(/\[\[[^|\]]+\|([^\]]+)]]/g, '$1')
    .replace(/\[\[([^\]]+)]]/g, '$1')
    .replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)]]?/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/[=]/g, '')
    .replace(/&nbsp;|&ensp;|&emsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function normalizeHeading(value: string): string {
  return cleanWikiText(value).replace(/\s+/g, '');
}

function sections(wikitext: string): Array<{ name: string; text: string; start: number }> {
  const headingPattern = /^(={2,6})\s*(.*?)\s*\1\s*$/gm;
  const headings: Array<{ name: string; start: number; bodyStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(wikitext))) {
    headings.push({
      name: normalizeHeading(match[2]),
      start: match.index,
      bodyStart: match.index + match[0].length,
    });
  }
  return headings.map((heading, index) => ({
    name: heading.name,
    start: heading.start,
    text: wikitext.slice(heading.bodyStart, headings[index + 1]?.start ?? wikitext.length).trim(),
  }));
}

function findSection(allSections: ReturnType<typeof sections>, names: string[]) {
  return allSections.find((section) =>
    names.some((name) => section.name === name || section.name.startsWith(name))
  );
}

function parseSteps(wikitext: string, allSections: ReturnType<typeof sections>): string[] {
  const stepSection = findSection(allSections, STEP_HEADINGS);
  const sectionSource = stepSection?.text || wikitext;
  const inlineProcess = sectionSource.match(
    /^\s*;\s*(?:过程|過程|步骤|步驟|做法|作法|制法)\s*[：:]\s*([\s\S]*?)(?=^\s*;\s*(?:建议|建議|备注|備註)\s*[：:]|^\s*==|(?![\s\S]))/m,
  )?.[1];
  const source = inlineProcess || sectionSource;
  const patterns = [
    /^\s*#(?![#*:;])\s*(.+)$/gm,
    /^\s*(?:\d+|[一二三四五六七八九十]+)[、.)）]\s*(.+)$/gm,
    /^\s*[（(][一二三四五六七八九十]+[）)]\s*(.+)$/gm,
  ];
  let steps: string[] = [];
  for (const pattern of patterns) {
    steps = [...source.matchAll(pattern)].map((match) => cleanWikiText(match[1])).filter(Boolean);
    if (steps.length) break;
  }
  if (!steps.length && stepSection) {
    steps = [...source.matchAll(/^\s*\*(?![*#:;])\s*(.+)$/gm)]
      .map((match) => cleanWikiText(match[1]))
      .filter(Boolean);
  }
  return [...new Set(steps)].slice(0, 30);
}

function splitIngredientEntries(value: string): string[] {
  // MediaWiki uses "*" for unordered lists and "#" for numbered cooking steps.
  // Never treat numbered steps as ingredient entries.
  const bulletEntries = [...value.matchAll(/^\s*\*(?![*#:;])\s*(.+)$/gm)].map((match) => match[1]);
  const numberedEntries = [...value.matchAll(/^\s*\d+[.)、]\s*(.+)$/gm)].map((match) => match[1]);
  const structuredEntries = [...numberedEntries, ...bulletEntries];
  const sourceEntries = structuredEntries.length ? structuredEntries : value.split(/\r?\n/).filter(Boolean);
  return sourceEntries.flatMap((entry) => {
    const cleaned = cleanWikiText(entry)
      .replace(/^(?:主食材|主辅料|主料|辅料|调料|调味料|配料)\s*[：:]\s*/, '');
    // Some pages describe all ingredients in one prose sentence, such as
    // "主料为小麦面粉，辅料为时令蔬菜，主要使用黄瓜，调料主要使用水、醋…".
    // Extract the ingredient clauses before falling back to delimiter splitting,
    // otherwise the introductory sentence itself is imported as an ingredient.
    const proseEntries = [...cleaned.matchAll(
      /(?:主料|辅料|调料|调味料)\s*(?:为|是|主要使用)\s*([^。；;]+?)(?=，\s*(?:主料|辅料|调料|调味料|可|也可|按)|[。；;]|$)/g,
    )].flatMap((match) => match[1]
      .split(/[，,、；;]/)
      .map((item) => item.trim().replace(/^(?:主要)?使用/, ''))
      .filter(Boolean));
    if (proseEntries.length) return proseEntries;
    return cleaned.split(/[，,、；;]/)
      .map((item) => item.trim())
      .filter((item, index) => Boolean(item) && (
        index === 0 ||
        /(?:\d|[一二三四五六七八九十两半])\s*[大小平]?\s*(?:千克|公斤|kg|公克|克|g|毫升|ml|公升|升|l|斤|两|杯|个|只|条|朵|片|根|块|汤匙|茶匙|大匙|大勺|平勺|勺|匙|张|碗|颗|支|瓶|段|瓣)|适量|少许|若干/i.test(item)
      ));
  });
}

function labeledIngredientEntries(wikitext: string): string[] {
  // Some older Wikibooks recipes put ingredient declarations inside the
  // "做法" section, e.g. "* 馅：原料：鲜奶，姜汁相混合。". Only inspect
  // content before an explicit step marker so subsequent # lines cannot leak in.
  const beforeSteps = wikitext.split(/^\s*(?:步骤|步驟)\s*[：:]\s*$/m)[0];
  return [...beforeSteps.matchAll(
    /^\s*\*\s*(?:[^：:\n]{1,12}[：:]\s*)?(?:原料|材料|用料|配料)[：:]\s*(.+)$/gm,
  )].flatMap((match) => match[1]
    .split(/[，,、；;]/)
    .map((item) => item.trim())
    .filter(Boolean));
}

function ingredientFromEntry(entry: string): Ingredient | null {
  const cleaned = cleanWikiText(entry)
    .replace(/^[*#;:]\s*/, '')
    .replace(/^[A-ZＡ-Ｚ]\s*料\s*/i, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/^(?:主食材|主辅料|主料|辅料|调料|调味料|配料)\s*[：:]?\s*/, '')
    .trim();
  if (!cleaned || cleaned.length > 100 || /^(适量|少许|若干)$/.test(cleaned)) return null;
  const amountPattern = /(?:约\s*)?(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?:\s*[-~～至到]\s*\d+(?:\.\d+)?)?|[一二三四五六七八九十两半]+)\s*[大小平]?\s*(?:千克|公斤|kg|公克|克|g|毫升|ml|公升|升|l|斤|两|杯|个|只|条|朵|片|根|块|汤匙|茶匙|大匙|大勺|平勺|勺|匙|张|碗|颗|支|瓶|段|瓣)/i;
  const amountMatch = cleaned.match(amountPattern);
  const consumedMatch = cleaned.match(new RegExp(`[（(](?:实耗|约耗|实际耗用?)\\s*(${amountPattern.source})[）)]`, 'i'));
  const qualitativeAmount = cleaned.match(/(?:适量|少许|若干)/)?.[0];
  const amount = consumedMatch?.[1]?.trim() || amountMatch?.[0]?.trim() || qualitativeAmount || '按需';
  let name = (amountMatch ? cleaned.slice(0, amountMatch.index) : cleaned)
    .replace(/[：:＝=.…·-]+$/, '')
    .replace(/\.{2,}|…+/g, '')
    .replace(/^(?:新鲜|熟|干|水发|去皮|去骨)\s*/, '')
    .trim();
  if (!name && amountMatch) name = cleaned.slice((amountMatch.index || 0) + amountMatch[0].length).trim();
  name = name
    .replace(/^[（(][^）)]+[）)]\s*/, '')
    .replace(/[：:].*$/, '')
    .replace(/[（(][^）)]*(?:可选|推荐)[^）)]*[）)]/g, '')
    .replace(/(?:相)?混合[。.]?$/, '')
    .replace(/等(?:调味品)?$/, '')
    .replace(/[。！？!?]+$/, '')
    .trim();
  if (/^(?:用量|海鲜|肉类|蔬菜|时令蔬菜|过程|步骤|建议|备注)$/.test(name)) return null;
  if (
    (!amountMatch && name.length > 12) ||
    (!amountMatch && /^(?:准备|将|把|用|放入|加入|倒入|搓|捏|烤|煮|炒|蒸|制成)/.test(name)) ||
    /^(?:最好|建议|为了|如果|可选用|或购买|约取|包括)/.test(name) ||
    /(?:所用)?(?:材料|原料|用料|配料)(?:为|是)?$/.test(name) ||
    /玻璃瓶|容器|器皿|模具|烤盘|炒锅|汤锅|电烤炉|电磁炉|冰箱/.test(name) ||
    /肉质|营养成分|风味|口感|增添|提升|富含|用于烹饪|释放出|代表|颜色翠|切成|精准调味|味道|鲜嫩|筋道|香气|提味|可以替换/.test(name)
  ) return null;
  return name ? { name, amount } : null;
}

function linkedIngredients(value: string): Ingredient[] {
  const ignored = /食谱|维基|方法|历史|文化|菜系|家常菜|中国|地区|页面|分类|炉|锅|模具|烤箱|^蒸$|^煮$|^炒$|^烤$/;
  return [...value.matchAll(/\[\[[^|\]]+\|([^\]]+)]]|\[\[([^\]]+)]]/g)]
    .map((match) => cleanWikiText(match[1] || match[2]))
    .filter((name) => name.length >= 1 && name.length <= 12 && !ignored.test(name))
    .map((name) => ({ name, amount: '按需' }));
}

function parseIngredients(
  wikitext: string,
  allSections: ReturnType<typeof sections>,
  steps: string[],
): Ingredient[] {
  const ingredientSection = findSection(allSections, INGREDIENT_HEADINGS);
  let entries = ingredientSection ? splitIngredientEntries(ingredientSection.text) : [];

  if (!entries.length) {
    entries = labeledIngredientEntries(wikitext);
  }

  if (!entries.length) {
    const textualIngredients = wikitext.match(
      /(?:^|\n)\s*;?\s*(?:原料|材料|用料)[：:]\s*([\s\S]*?)(?=\n\s*;\s*(?:过程|過程|步骤|步驟|制作方法|做法|作法|制法|建议|建議)[：:]|\n\s*(?:步骤|步驟|制作方法|做法|作法|制法)[：:]|\n==|(?![\s\S]))/im,
    )?.[1];
    if (textualIngredients) entries = splitIngredientEntries(textualIngredients);
  }

  let ingredients = entries
    .map(ingredientFromEntry)
    .filter((ingredient): ingredient is Ingredient => Boolean(ingredient));
  if (ingredients.length < 2) {
    const stepSection = findSection(allSections, STEP_HEADINGS);
    ingredients.push(...linkedIngredients(stepSection?.text || steps.join('\n')));
  }

  const seen = new Set<string>();
  return ingredients
    .map((ingredient) => ({ ...ingredient, name: ingredient.name.replace(/^食谱\//, '') }))
    .filter((ingredient) => {
      const key = normalizeTitle(ingredient.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
}

function normalizeTitle(value: string): string {
  return toSimplified(value)
    .toLowerCase()
    .replace(/^食[谱譜]\//, '')
    .replace(/的做法$/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[^a-z0-9\u3400-\u9fff]/g, '');
}

function normalizeFoodName(value: string): string {
  return normalizeTitle(value)
    .replace(/西红柿/g, '番茄')
    .replace(/马铃薯/g, '土豆')
    .replace(/鸡腿(?!肉)/g, '鸡腿肉')
    .replace(/北豆腐|嫩豆腐|日本豆腐/g, '豆腐');
}

function gramsFromAmount(name: string, amount: string): number {
  const match = amount.match(/(\d+(?:\.\d+)?)\s*(千克|公斤|kg|公克|克|g|毫升|ml|公升|升|l|斤|两)(?![a-z])/i);
  if (!match) {
    const countMatch = amount.match(/(\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[一二三四五六七八九十两半]+)\s*(个|只|条|朵|片|根|块|颗|支|杯|碗|汤匙|茶匙|大匙|勺|匙|瓶)/);
    if (!countMatch) return 0;
    const chineseNumbers: Record<string, number> = {
      一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
    };
    const fraction = countMatch[1].match(/^(\d+)\s*\/\s*(\d+)$/);
    const count = fraction
      ? Number(fraction[1]) / Number(fraction[2])
      : Number(countMatch[1]) || chineseNumbers[countMatch[1]] || 0;
    const weights: Array<[RegExp, number]> = [
      [/鸡蛋|鸭蛋|蛋清|蛋黄/, 50], [/番茄|西红柿/, 180], [/土豆|洋葱/, 180],
      [/鸡腿/, 180], [/鸡|鸭|鱼/, 700], [/香菇|蘑菇/, 20], [/青椒|彩椒/, 80],
      [/苹果|梨|橙/, 180], [/香蕉|玉米/, 120], [/蒜/, 6], [/姜/, 8],
      [/面包|吐司/, 30], [/杯|碗/, 200], [/勺|匙/, 10],
    ];
    return count * (weights.find(([pattern]) => pattern.test(`${name}${countMatch[2]}`))?.[1] || 0);
  }
  const value = Number(match[1]);
  if (/千克|公斤|kg|公升|升|l/i.test(match[2])) return value * 1000;
  if (match[2] === '斤') return value * 500;
  if (match[2] === '两') return value * 50;
  return value;
}

function findFood(name: string, foods: NutrientFood[]): NutrientFood | undefined {
  const normalized = normalizeFoodName(name);
  return foods
    .map((food) => ({ food, normalized: normalizeFoodName(food.name) }))
    .filter(({ normalized: candidate }) =>
      candidate === normalized ||
      (candidate.length >= 2 && normalized.includes(candidate)) ||
      (normalized.length >= 2 && candidate.includes(normalized))
    )
    .sort((a, b) => Math.abs(a.normalized.length - normalized.length) - Math.abs(b.normalized.length - normalized.length))[0]?.food;
}

function estimateNutrition(ingredients: Ingredient[], foods: NutrientFood[]) {
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  for (const ingredient of ingredients) {
    if (/盐|味精|鸡精|水$|料酒|酱油|醋|胡椒|香料/.test(ingredient.name)) continue;
    const grams = gramsFromAmount(ingredient.name, ingredient.amount);
    const food = grams ? findFood(ingredient.name, foods) : undefined;
    if (!food) continue;
    const multiplier = grams / 100;
    calories += food.calories_100g * multiplier;
    protein += food.protein_100g * multiplier;
    carbs += food.carbs_100g * multiplier;
    fat += food.fat_100g * multiplier;
  }
  const scale = calories > 1200 ? 1200 / calories : 1;
  return {
    calories: Math.round(calories * scale),
    protein: Math.round(protein * scale * 10) / 10,
    carbs: Math.round(carbs * scale * 10) / 10,
    fat: Math.round(fat * scale * 10) / 10,
  };
}

function categoryFor(title: string, ingredients: Ingredient[], steps: string[]): string {
  const text = `${title} ${ingredients.map((item) => item.name).join(' ')}`;
  if (/饭|面|粉|粥|饼|糕|包|馒头|甜|汤圆|吐司|三明治|米糊|果冻|布丁|咖啡|茶$|饮/.test(title)) return '营养餐单';
  if (steps.length <= 3 && /煎|炒|拌|煮|蒸|微波/.test(steps.join(' '))) return '快手菜';
  if (/鸡|鸭|鹅|猪|牛|羊|鱼|虾|蟹|肉|蛋|排骨|海鲜|贝/.test(text)) return '增肌';
  return '减脂';
}

function fallbackNutrition(category: string) {
  const calories = category === '增肌' ? 520 : category === '减脂' ? 300 : category === '快手菜' ? 360 : 420;
  const ratios = category === '增肌'
    ? { protein: 0.25, carbs: 0.35, fat: 0.4 }
    : category === '减脂'
      ? { protein: 0.22, carbs: 0.43, fat: 0.35 }
      : { protein: 0.16, carbs: 0.52, fat: 0.32 };
  return {
    calories,
    protein: Math.round((calories * ratios.protein / 4) * 10) / 10,
    carbs: Math.round((calories * ratios.carbs / 4) * 10) / 10,
    fat: Math.round((calories * ratios.fat / 9) * 10) / 10,
  };
}

function parseRecipe(page: WikiPage, foods: NutrientFood[]): ParsedRecipe | null {
  const revision = page.revisions?.[0];
  const wikitext = revision?.slots?.main?.content || '';
  if (!revision?.revid || !wikitext) return null;
  const allSections = sections(wikitext);
  const steps = parseSteps(wikitext, allSections);
  const rawIngredients = parseIngredients(wikitext, allSections, steps);
  const title = toSimplified(page.title.replace(/^食[谱譜]\//, '')).trim();
  const ingredients = ensureIngredientGroups(rawIngredients, title);
  if (steps.length < 2 || ingredients.length < 2) return null;

  if (/参考附录|度量衡|菜系|料理$|^食谱$/.test(title)) return null;
  const firstHeading = allSections[0]?.start ?? wikitext.length;
  const description = cleanWikiText(wikitext.slice(0, firstHeading))
    .replace(/^食谱\s*>\s*/, '')
    .slice(0, 1000);
  const category = categoryFor(title, ingredients, steps);
  let nutrition = estimateNutrition(ingredients, foods);
  const minimumCalories = category === '增肌' ? 250 : category === '减脂' ? 120 : category === '快手菜' ? 180 : 100;
  const macrosAreUnbalanced = (category === '增肌' && nutrition.protein < 8) ||
    (nutrition.protein + nutrition.carbs < 3 && nutrition.fat > 10);
  const usedFallbackNutrition = nutrition.calories < minimumCalories || macrosAreUnbalanced;
  if (usedFallbackNutrition) nutrition = fallbackNutrition(category);
  const rawText = cleanWikiText(wikitext);
  const timeMatches = [...rawText.matchAll(/(?:约|大约|需要|用时|耗时)[^\d]{0,8}(\d+)\s*分钟/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= 600);
  const cookTime = (timeMatches.length ? Math.max(...timeMatches) : 0) || Math.min(120, Math.max(10, steps.length * 5));
  const categories = [...wikitext.matchAll(/\[\[Category:([^|\]]+)/gi)]
    .map((match) => cleanWikiText(match[1]).replace(/^食谱\//, ''))
    .filter((tag) => tag && !/^食谱$/.test(tag));
  const sourceUrl = `https://zh.wikibooks.org/w/index.php?curid=${page.pageid}&oldid=${revision.revid}`;

  const quality = assessRecipeQuality({
    source: SOURCE,
    cookTime,
    ...nutrition,
    ingredients,
    steps,
    nutritionBasis: usedFallbackNutrition ? 'category_fallback' : 'ingredient_estimate',
  });
  return {
    externalId: String(page.pageid),
    title,
    description: description || `${title}的中文维基教科书社区菜谱。`,
    cookTime,
    difficulty: steps.length <= 3 ? '简单' : steps.length <= 7 ? '中等' : '困难',
    ...nutrition,
    category,
    tags: [...new Set(['维基教科书', '营养估算', ...categories])].slice(0, 10),
    steps,
    ingredients,
    sourceUrl,
    revision: String(revision.revid),
    attribution: `中文维基教科书贡献者，《${page.title}》，修订版本 ${revision.revid}`,
    qualityStatus: quality.qualityStatus,
    nutritionBasis: quality.nutritionBasis,
    qualityIssues: quality.issues,
  };
}

async function main() {
  initDatabase();
  const foods = db.prepare(`
    SELECT name, calories_100g, protein_100g, carbs_100g, fat_100g
    FROM ingredients_library
    WHERE deleted_at IS NULL
      AND source IN ('usda_fdc_foundation', 'system', 'taiwan_fda')
      AND calories_100g BETWEEN 0 AND 1000
      AND protein_100g BETWEEN 0 AND 100
      AND carbs_100g BETWEEN 0 AND 100
      AND fat_100g BETWEEN 0 AND 100
    ORDER BY CASE source WHEN 'usda_fdc_foundation' THEN 0 WHEN 'system' THEN 1 ELSE 2 END, id
  `).all() as NutrientFood[];
  const pages = await fetchPages();
  const parsed = pages
    .map((page) => parseRecipe(page, foods))
    .filter((recipe): recipe is ParsedRecipe => Boolean(recipe));
  const sourceRevision = parsed.map((recipe) => Number(recipe.revision) || 0).sort((left, right) => right - left)[0]?.toString() || 'unknown';
  batchId = beginImportBatch('recipe', { source: SOURCE, revision: sourceRevision, dataLicense: LICENSE, dryRun });

  const existingByExternalId = db.prepare('SELECT id FROM recipes WHERE source = ? AND external_id = ?');
  const existingTitles = new Map(
    (db.prepare('SELECT id, title, source FROM recipes WHERE deleted_at IS NULL').all() as Array<{ id: number; title: string; source: string }>)
      .map((row) => [normalizeTitle(row.title), row])
  );
  const insert = db.prepare(`
    INSERT INTO recipes (
      title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat,
      category, tags, steps_json, ingredients_json, source, status, external_id, source_url,
      data_license, source_revision, source_attribution, quality_status, nutrition_basis,
      quality_issues_json, canonical_key, source_content_hash, import_batch_id, serving_size,
      prep_time, required_kitchenware_json, meal_types_json, updated_at
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const update = db.prepare(`
    UPDATE recipes SET
      title = ?, description = ?, cook_time = ?, difficulty = ?, calories = ?, protein = ?,
      carbs = ?, fat = ?, category = ?, tags = ?, steps_json = ?, ingredients_json = ?,
      status = 'approved', source_url = ?, data_license = ?, source_revision = ?,
      source_attribution = ?, quality_status = ?, nutrition_basis = ?, quality_issues_json = ?,
      canonical_key = ?, source_content_hash = ?, import_batch_id = ?, serving_size = ?, prep_time = ?,
      required_kitchenware_json = ?, meal_types_json = ?,
      deleted_at = NULL, deleted_by = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;
  let duplicateTitles = 0;
  let rejectedByGovernance = 0;
  const transaction = db.transaction(() => {
    for (const recipe of parsed) {
      const requiredKitchenware = requiredKitchenwareFor(recipe);
      const governanceIssues = validateRecipePublication({
        title: recipe.title, source: SOURCE, sourceUrl: recipe.sourceUrl, dataLicense: LICENSE,
        sourceAttribution: recipe.attribution, servingSize: 2, prepTime: 0, cookTime: recipe.cookTime,
        ingredients: recipe.ingredients, steps: recipe.steps, requiredKitchenware,
      });
      if (governanceIssues.length) {
        rejectedByGovernance += 1;
        continue;
      }
      const existing = existingByExternalId.get(SOURCE, recipe.externalId) as { id: number } | undefined;
      const canonicalKey = normalizeTitle(recipe.title);
      const fingerprint = recipeContentFingerprint({ title: recipe.title, ingredients: recipe.ingredients, steps: recipe.steps });
      const values = [
        recipe.title, recipe.description, recipe.cookTime, recipe.difficulty, recipe.calories,
        recipe.protein, recipe.carbs, recipe.fat, recipe.category, JSON.stringify(recipe.tags),
        JSON.stringify(recipe.steps), JSON.stringify(recipe.ingredients),
      ] as const;
      if (existing) {
        if (!dryRun) {
          const before = contentSnapshot('recipe', existing.id) || null;
          update.run(
            ...values, recipe.sourceUrl, LICENSE, recipe.revision, recipe.attribution,
            recipe.qualityStatus, recipe.nutritionBasis, JSON.stringify(recipe.qualityIssues),
            canonicalKey, fingerprint, batchId, 2, 0, JSON.stringify(requiredKitchenware), JSON.stringify([]), existing.id,
          );
          setRecipeKitchenwareRequirements(existing.id, requiredKitchenware, { source: SOURCE });
          findRecipeDuplicateCandidates(existing.id);
          trackImportMutation('recipe', { batchId: batchId!, contentId: existing.id, action: 'update', before, after: contentSnapshot('recipe', existing.id)! });
        }
        updated += 1;
        continue;
      }
      if (existingTitles.has(normalizeTitle(recipe.title))) {
        duplicateTitles += 1;
        continue;
      }
      if (!dryRun) {
        const result = insert.run(
          ...values, SOURCE, recipe.externalId, recipe.sourceUrl, LICENSE,
          recipe.revision, recipe.attribution, recipe.qualityStatus, recipe.nutritionBasis,
          JSON.stringify(recipe.qualityIssues), canonicalKey, fingerprint, batchId, 2, 0,
          JSON.stringify(requiredKitchenware), JSON.stringify([]),
        );
        const recipeId = Number(result.lastInsertRowid);
        setRecipeKitchenwareRequirements(recipeId, requiredKitchenware, { source: SOURCE });
        findRecipeDuplicateCandidates(recipeId);
        trackImportMutation('recipe', { batchId: batchId!, contentId: recipeId, action: 'insert', before: null, after: contentSnapshot('recipe', recipeId)! });
      }
      existingTitles.set(normalizeTitle(recipe.title), { id: -1, title: recipe.title, source: SOURCE });
      inserted += 1;
    }
  });
  transaction();

  const stats = {
    categoryPages: pages.length,
    structurallyValid: parsed.length,
    inserted,
    updated,
    duplicateTitles,
    rejectedByGovernance,
    skippedIncomplete: pages.length - parsed.length,
    dryRun,
  };
  finishImportBatch('recipe', batchId, { status: dryRun ? 'validated' : 'committed', stats });
  console.log(JSON.stringify({ batchId, ...stats }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    if (batchId && !dryRun) finishImportBatch('recipe', batchId, { status: 'failed', stats: {}, errors: [error instanceof Error ? error.message : String(error)] });
    process.exitCode = 1;
  })
  .finally(() => db.close());
