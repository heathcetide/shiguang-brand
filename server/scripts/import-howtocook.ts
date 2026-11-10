/**
 * 将 Anduin2017/HowToCook 的中文 Markdown 菜谱导入本地食谱库。
 *
 * 默认排除 drink、condiment 和 template。导入是幂等的：再次运行会按
 * source + external_id 更新已有记录，不会制造重复数据。
 *
 * 用法：
 *   pnpm --dir server import:howtocook
 *   pnpm --dir server import:howtocook -- --repo=/absolute/path/to/HowToCook
 *   pnpm --dir server import:howtocook -- --dry-run
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { db, initDatabase } from '../src/storage/db.js';
import { assessRecipeQuality, type NutritionBasis, type RecipeQualityIssue, type RecipeQualityStatus } from '../src/services/recipeQuality.js';
import { ensureIngredientGroups, type IngredientGroup } from '../src/utils/ingredientGroups.js';

const SOURCE = 'howtocook';
const LICENSE = 'Unlicense';
const REPOSITORY_URL = 'https://github.com/Anduin2017/HowToCook';
const MEDIA_URL = 'https://media.githubusercontent.com/media/Anduin2017/HowToCook';
const EXCLUDED_GROUPS = new Set(['drink', 'condiment', 'template']);
const GROUPS: Record<string, { category: string; tag: string }> = {
  vegetable_dish: { category: '减脂', tag: '素菜' },
  staple: { category: '营养餐单', tag: '主食' },
  'semi-finished': { category: '快手菜', tag: '半成品加工' },
  dessert: { category: '营养餐单', tag: '甜品' },
  meat_dish: { category: '增肌', tag: '荤菜' },
  soup: { category: '营养餐单', tag: '汤与粥' },
  aquatic: { category: '增肌', tag: '水产' },
  breakfast: { category: '营养餐单', tag: '早餐' },
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
  imageUrl: string | null;
  imageSource: string | null;
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
  qualityStatus: RecipeQualityStatus;
  nutritionBasis: NutritionBasis;
  qualityIssues: RecipeQualityIssue[];
};

const args = process.argv.slice(2);
const repoArg = args.find((arg) => arg.startsWith('--repo='))?.slice('--repo='.length);
const dryRun = args.includes('--dry-run');
const keepRepository = args.includes('--keep-repository');
let temporaryRoot: string | null = null;

function walkMarkdownFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function section(markdown: string, heading: string): string {
  const match = new RegExp(`^## ${heading}\\s*$`, 'm').exec(markdown);
  if (!match) return '';
  const contentStart = match.index + match[0].length;
  const remainder = markdown.slice(contentStart);
  const nextHeading = remainder.search(/^## /m);
  return (nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder).trim();
}

function bulletLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*+]\s+(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line))
    .map(cleanMarkdown)
    .filter(Boolean);
}

function parseIngredients(markdown: string): Ingredient[] {
  const calculation = bulletLines(section(markdown, '计算'));
  const required = bulletLines(section(markdown, '必备原料和工具'));
  const source = calculation.length ? calculation : required;
  const seen = new Set<string>();
  const ingredients: Ingredient[] = [];

  for (const line of source) {
    const [left, ...right] = line.split(/\s*[=＝]\s*/);
    let rawName = left.replace(/^\d+[.)、]\s*/, '').trim();
    let amount = right.join('=').trim();
    if (!amount) {
      const inlineAmount = rawName.match(/\s+((?:约\s*)?(?:\d+(?:\.\d+)?|[一二三四五六七八九十两半]+)(?:\s*[-~至到]\s*(?:\d+(?:\.\d+)?|[一二三四五六七八九十两半]+))?\s*(?:千克|公斤|kg|克|g|毫升|ml|升|l|个|只|条|朵|片|根|块|勺|张|碗|杯).*)$/i);
      if (inlineAmount?.index !== undefined) {
        amount = inlineAmount[1].trim();
        rawName = rawName.slice(0, inlineAmount.index).trim();
      }
    }
    const name = rawName.replace(/[（(][^）)]*(?:可选|推荐|最佳)[^）)]*[）)]/g, '').trim();
    if (!name || seen.has(name) || /^(锅|碗|盘|刀|筷|勺|烤箱|冰箱|空气炸锅)$/.test(name)) continue;
    seen.add(name);
    ingredients.push({ name, amount: amount || '按需' });
  }
  return ingredients.slice(0, 50);
}

function parseSteps(markdown: string): string[] {
  const operation = section(markdown, '操作');
  return operation
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+[.)、]\s*(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line))
    .map(cleanMarkdown)
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeFoodName(value: string): string {
  return value
    .toLowerCase()
    .replace(/西红柿/g, '番茄')
    .replace(/马铃薯/g, '土豆')
    .replace(/鸡腿(?!肉)/g, '鸡腿肉')
    .replace(/北豆腐|嫩豆腐|日本豆腐/g, '豆腐')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/生姜片|姜片/g, '生姜')
    .replace(/葱花|小葱|香葱/g, '葱')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function amountInGrams(name: string, amount: string): number {
  const text = `${name} ${amount}`;
  const unitMatch = text.match(/(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g|毫升|ml|升|l)(?![a-z])/i);
  if (unitMatch) {
    const value = Number(unitMatch[1]);
    return /千克|公斤|kg|升|l/i.test(unitMatch[2]) ? value * 1000 : value;
  }
  const countMatch = text.match(/(\d+(?:\.\d+)?|[一二三四五六七八九十两半]+)\s*(个|只|枚|颗|朵|根|片|张|条|块)/);
  if (!countMatch) return 0;
  const chineseNumbers: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
  };
  const defaultWeights: Array<[RegExp, number]> = [
    [/鸡蛋|鸭蛋/, 50], [/番茄|西红柿/, 180], [/土豆/, 180], [/鸡腿/, 180],
    [/香菇|蘑菇/, 20], [/青椒|彩椒/, 80], [/洋葱/, 180], [/苹果|梨|橙/, 180],
    [/香蕉|玉米/, 120], [/蒜/, 6], [/姜/, 8], [/面包|吐司/, 30],
  ];
  const weight = defaultWeights.find(([pattern]) => pattern.test(name))?.[1] || 0;
  const count = Number(countMatch[1]) || chineseNumbers[countMatch[1]] || 0;
  return count * weight;
}

function findFood(name: string, foods: NutrientFood[]): NutrientFood | undefined {
  const normalized = normalizeFoodName(name);
  if (!normalized) return undefined;
  return foods
    .map((food) => ({ food, normalized: normalizeFoodName(food.name) }))
    .filter(({ normalized: candidate }) =>
      candidate === normalized ||
      (candidate.length >= 2 && normalized.includes(candidate)) ||
      (normalized.length >= 2 && candidate.includes(normalized))
    )
    .sort((a, b) => Math.abs(a.normalized.length - normalized.length) - Math.abs(b.normalized.length - normalized.length))[0]?.food;
}

function estimateMacros(
  ingredients: Ingredient[],
  calories: number,
  category: string,
  foods: NutrientFood[],
): { protein: number; carbs: number; fat: number } {
  let estimatedCalories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let matchedIngredients = 0;
  for (const ingredient of ingredients) {
    if (/盐|味精|鸡精|水$|料酒|酱油|醋|胡椒|香料/.test(ingredient.name)) continue;
    const grams = amountInGrams(ingredient.name, ingredient.amount);
    const food = grams > 0 ? findFood(ingredient.name, foods) : undefined;
    if (!food) continue;
    matchedIngredients += 1;
    const multiplier = grams / 100;
    estimatedCalories += food.calories_100g * multiplier;
    protein += food.protein_100g * multiplier;
    carbs += food.carbs_100g * multiplier;
    fat += food.fat_100g * multiplier;
  }
  if (matchedIngredients >= 2 && estimatedCalories > 0 && protein + carbs + fat > 0 && calories > 0) {
    const scale = Math.min(3, Math.max(0.5, calories / estimatedCalories));
    return {
      protein: Math.round(Math.min(protein * scale, calories / 4) * 10) / 10,
      carbs: Math.round(Math.min(carbs * scale, calories / 4) * 10) / 10,
      fat: Math.round(Math.min(fat * scale, calories / 9) * 10) / 10,
    };
  }

  const ratios = category === '增肌'
    ? { protein: 0.25, carbs: 0.35, fat: 0.4 }
    : category === '减脂'
      ? { protein: 0.22, carbs: 0.43, fat: 0.35 }
      : { protein: 0.16, carbs: 0.52, fat: 0.32 };
  const quality = assessRecipeQuality({
    source: SOURCE,
    cookTime,
    calories,
    ...macros,
    ingredients,
    steps,
  });
  return {
    protein: Math.round((calories * ratios.protein / 4) * 10) / 10,
    carbs: Math.round((calories * ratios.carbs / 4) * 10) / 10,
    fat: Math.round((calories * ratios.fat / 9) * 10) / 10,
  };
}

function parseRecipe(
  filename: string,
  repoRoot: string,
  revision: string,
  foods: NutrientFood[],
): ParsedRecipe | null {
  const markdown = readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  const externalId = path.relative(repoRoot, filename).split(path.sep).join('/');
  const group = externalId.split('/')[1];
  const mapping = GROUPS[group];
  if (!mapping || EXCLUDED_GROUPS.has(group)) return null;

  const titleMatch = markdown.match(/^#\s+(.+?)(?:的做法)?\s*$/m);
  const title = cleanMarkdown(titleMatch?.[1] || path.basename(filename, '.md')).replace(/的做法$/, '').trim();
  const steps = parseSteps(markdown);
  const ingredients = ensureIngredientGroups(parseIngredients(markdown), title);
  if (!title || !steps.length || !ingredients.length) return null;

  const introStart = titleMatch ? (titleMatch.index || 0) + titleMatch[0].length : 0;
  const introEnd = markdown.search(/^预估烹饪难度：|^## /m);
  const description = cleanMarkdown(markdown.slice(introStart, introEnd > introStart ? introEnd : undefined)).slice(0, 1000);
  const calories = Number(markdown.match(/预估卡路里[：:]\s*(\d+(?:\.\d+)?)\s*(?:大卡|千卡|kcal)/i)?.[1]) || 0;
  const stars = markdown.match(/预估烹饪难度[：:]\s*([★☆]+)/)?.[1]?.replace(/☆/g, '').length || 0;
  const difficulty = stars <= 1 ? '简单' : stars <= 3 ? '中等' : '困难';
  const timeCandidates = description.match(/(?:大约|约|需要|只需|耗时|用时)[^\d]{0,8}(\d+)\s*分钟/g) || [];
  const cookTime = Number(timeCandidates[0]?.match(/(\d+)/)?.[1]) || (stars <= 1 ? 10 : stars <= 3 ? 25 : 45);
  const macros = estimateMacros(ingredients, calories, mapping.category, foods);

  const imageMatch = markdown.match(/!\[[^\]]*]\(([^)]+)\)/);
  const imageSource = imageMatch?.[1] && !/^https?:\/\//i.test(imageMatch[1])
    ? path.resolve(path.dirname(filename), decodeURIComponent(imageMatch[1].split(/\s+["']/)[0]))
    : null;
  const encodedPath = externalId.split('/').map(encodeURIComponent).join('/');
  return {
    externalId,
    title,
    description: description || `${mapping.tag}菜谱，内容来源于 HowToCook 开源项目。`,
    imageUrl: null,
    imageSource: imageSource && imageSource.startsWith(`${repoRoot}${path.sep}`) && existsSync(imageSource) && statSync(imageSource).isFile()
      ? imageSource
      : null,
    cookTime,
    difficulty,
    calories,
    ...macros,
    category: mapping.category,
    tags: [mapping.tag, 'HowToCook', '营养估算'],
    steps,
    ingredients,
    sourceUrl: `${REPOSITORY_URL}/blob/${revision}/${encodedPath}`,
    qualityStatus: quality.qualityStatus,
    nutritionBasis: quality.nutritionBasis,
    qualityIssues: quality.issues,
  };
}

function extensionFromImage(bytes: Buffer, fallback: string): string {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return '.gif';
  return fallback || '.jpg';
}

async function downloadLfsImage(imageSource: string, repoRoot: string, revision: string): Promise<Buffer> {
  const relativePath = path.relative(repoRoot, imageSource).split(path.sep).map(encodeURIComponent).join('/');
  const url = `${MEDIA_URL}/${revision}/${relativePath}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.toString('utf8', 0, 42).startsWith('version https://git-lfs.github.com/spec/v1')) {
        throw new Error('下载结果仍是 Git LFS 指针');
      }
      return bytes;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`图片下载失败：${url} (${String(lastError)})`);
}

async function materializeImage(
  recipe: ParsedRecipe,
  repoRoot: string,
  revision: string,
  imageDirectory: string,
): Promise<string | null> {
  if (!recipe.imageSource) return null;
  const imageHash = crypto.createHash('sha1').update(recipe.externalId).digest('hex');
  const sourceExtension = path.extname(recipe.imageSource).toLowerCase() || '.jpg';
  const candidateExtensions = [...new Set([sourceExtension, '.webp', '.jpg', '.jpeg', '.png', '.gif'])];
  const stalePointerPaths: string[] = [];
  for (const extension of candidateExtensions) {
    const existingName = `${imageHash}${extension}`;
    const existingPath = path.join(imageDirectory, existingName);
    if (!existsSync(existingPath)) continue;
    const existingBytes = readFileSync(existingPath);
    if (existingBytes.length > 300 && !existingBytes.toString('utf8', 0, 80).startsWith('version https://git-lfs.github.com/spec/v1')) {
      stalePointerPaths.forEach((pointerPath) => unlinkSync(pointerPath));
      return `/media/recipes/howtocook/${existingName}`;
    }
    if (existingBytes.toString('utf8', 0, 80).startsWith('version https://git-lfs.github.com/spec/v1')) {
      stalePointerPaths.push(existingPath);
    }
  }
  const localBytes = readFileSync(recipe.imageSource);
  const isLfsPointer = localBytes.toString('utf8', 0, 80).startsWith('version https://git-lfs.github.com/spec/v1');
  const bytes = isLfsPointer ? await downloadLfsImage(recipe.imageSource, repoRoot, revision) : localBytes;
  const extension = extensionFromImage(bytes, sourceExtension);
  const imageName = `${imageHash}${extension}`;
  const imagePath = path.join(imageDirectory, imageName);
  writeFileSync(imagePath, bytes);
  stalePointerPaths
    .filter((pointerPath) => pointerPath !== imagePath)
    .forEach((pointerPath) => unlinkSync(pointerPath));
  return `/media/recipes/howtocook/${imageName}`;
}

async function main() {
  initDatabase();
  let repoRoot: string;
  if (repoArg) {
    repoRoot = path.resolve(repoArg);
    if (!existsSync(path.join(repoRoot, 'dishes'))) throw new Error(`无效的 HowToCook 仓库路径：${repoRoot}`);
  } else {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'dietdigidose-howtocook-'));
    repoRoot = path.join(temporaryRoot, 'HowToCook');
    console.log('正在下载 HowToCook...');
    execFileSync('git', ['clone', '--depth', '1', `${REPOSITORY_URL}.git`, repoRoot], { stdio: 'inherit' });
  }

  const revision = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
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
  const files = walkMarkdownFiles(path.join(repoRoot, 'dishes')).sort();
  const parsed = files
    .map((filename) => parseRecipe(filename, repoRoot, revision, foods))
    .filter((recipe): recipe is ParsedRecipe => Boolean(recipe));

  const imageDirectory = path.resolve(process.cwd(), 'public/recipes/howtocook');
  if (!dryRun) mkdirSync(imageDirectory, { recursive: true });
  const imageUrls = new Map<string, string | null>();
  let copiedImages = 0;
  if (!dryRun) {
    console.log('正在处理菜谱图片（包括 Git LFS 图片）...');
    for (let index = 0; index < parsed.length; index += 8) {
      const batch = parsed.slice(index, index + 8);
      const results = await Promise.all(batch.map(async (recipe) => ({
        externalId: recipe.externalId,
        imageUrl: await materializeImage(recipe, repoRoot, revision, imageDirectory).catch((error) => {
          console.warn(`跳过图片 ${recipe.externalId}: ${String(error)}`);
          return null;
        }),
      })));
      for (const result of results) {
        imageUrls.set(result.externalId, result.imageUrl);
        if (result.imageUrl) copiedImages += 1;
      }
      if (index + 8 < parsed.length) console.log(`图片进度：${Math.min(index + 8, parsed.length)}/${parsed.length}`);
    }
  } else {
    for (const recipe of parsed) {
      imageUrls.set(recipe.externalId, recipe.imageSource ? '(dry-run image)' : null);
      if (recipe.imageSource) copiedImages += 1;
    }
  }
  const existing = db.prepare('SELECT id FROM recipes WHERE source = ? AND external_id = ?');
  const insert = db.prepare(`
    INSERT INTO recipes (
      title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat,
      category, tags, steps_json, ingredients_json, source, status, external_id, source_url,
      data_license, source_revision, quality_status, nutrition_basis, quality_issues_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const update = db.prepare(`
    UPDATE recipes SET
      title = ?, description = ?, image_url = ?, cook_time = ?, difficulty = ?, calories = ?,
      protein = ?, carbs = ?, fat = ?, category = ?, tags = ?, steps_json = ?, ingredients_json = ?,
      status = 'approved', source_url = ?, data_license = ?, source_revision = ?,
      quality_status = ?, nutrition_basis = ?, quality_issues_json = ?,
      deleted_at = NULL, deleted_by = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;
  const transaction = db.transaction(() => {
    for (const recipe of parsed) {
      const imageUrl = dryRun && recipe.imageSource ? null : imageUrls.get(recipe.externalId) || null;
      const values = [
        recipe.title, recipe.description, imageUrl, recipe.cookTime, recipe.difficulty,
        recipe.calories, recipe.protein, recipe.carbs, recipe.fat, recipe.category,
        JSON.stringify(recipe.tags), JSON.stringify(recipe.steps), JSON.stringify(recipe.ingredients),
      ] as const;
      const row = existing.get(SOURCE, recipe.externalId) as { id: number } | undefined;
      if (row) {
        if (!dryRun) update.run(
          ...values, recipe.sourceUrl, LICENSE, revision, recipe.qualityStatus,
          recipe.nutritionBasis, JSON.stringify(recipe.qualityIssues), row.id,
        );
        updated += 1;
      } else {
        if (!dryRun) insert.run(
          ...values, SOURCE, recipe.externalId, recipe.sourceUrl, LICENSE, revision,
          recipe.qualityStatus, recipe.nutritionBasis, JSON.stringify(recipe.qualityIssues),
        );
        inserted += 1;
      }
    }
  });
  transaction();

  const summary = {
    revision,
    scannedMarkdownFiles: files.length,
    importableRecipes: parsed.length,
    inserted,
    updated,
    copiedImages,
    skipped: files.length - parsed.length,
    dryRun,
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    db.close();
    if (temporaryRoot && !keepRepository) rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

void run();
