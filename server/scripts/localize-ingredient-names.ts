/**
 * 汉化食材库显示名。
 *
 * - 中文名称统一转换为简体中文；
 * - Open Food Facts 等来源的拉丁字母名称翻译为简体中文；
 * - 品牌名保留在全角括号内；
 * - original_name 永久保留导入时的原始名称。
 */
import { Converter } from 'opencc-js';
import { db, initDatabase } from '../src/storage/db.js';

type IngredientRow = {
  id: number;
  name: string;
  original_name: string | null;
  category: string | null;
};

const toSimplified = Converter({ from: 'tw', to: 'cn' });
const chinesePattern = /[\u3400-\u9fff]/;
const latinPattern = /[A-Za-z]/;
const trailingBrandPattern = /^(.*?)（([^（）]+)）\s*$/;
const translationCache = new Map<string, string>();

const categoryFallbacks: Record<string, string> = {
  饮品: '进口饮品',
  乳制品: '进口乳制品',
  蔬菜水果: '进口果蔬食品',
  肉食蛋类: '进口肉蛋食品',
  粮油干货: '进口粮油食品',
  坚果豆类: '进口坚果豆类食品',
  其他食品: '进口食品',
};

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function splitProductAndBrand(name: string): { product: string; brand: string | null } {
  const match = name.match(trailingBrandPattern);
  if (!match) return { product: name.trim(), brand: null };
  return { product: match[1].trim(), brand: match[2].trim() };
}

function polishTranslation(translated: string, original: string): string {
  let result = toSimplified(translated)
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。；：！？])/g, '$1')
    .trim();

  // 机器翻译在食品语境中容易产生的固定误译。
  if (/\brice cakes?\b/i.test(original)) {
    result = result.replace(/年糕/g, '米饼');
  }
  if (/\bstock cubes?\b/i.test(original)) {
    result = result.replace(/库存立方体|股票立方体/g, '高汤块');
  }
  if (/\bsourdough\b/i.test(original)) {
    result = result.replace(/酸面团(?!面包)/g, '酸面包');
  }
  return result;
}

async function translateToChinese(text: string): Promise<string> {
  const cached = translationCache.get(text);
  if (cached) return cached;

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', 'zh-CN');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  let lastError = '未知错误';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'DietDigiDose/1.0 ingredient-localizer' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as Array<unknown>;
      const segments = Array.isArray(payload[0]) ? payload[0] as Array<unknown> : [];
      const translated = segments
        .map((segment) => Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : '')
        .join('')
        .trim();
      if (!translated) throw new Error('翻译结果为空');
      const polished = polishTranslation(translated, text);
      translationCache.set(text, polished);
      return polished;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(attempt * 500);
    }
  }
  throw new Error(`翻译“${text}”失败：${lastError}`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  initDatabase();
  const rows = db.prepare(`
    SELECT id, name, original_name, category
    FROM ingredients_library
    WHERE deleted_at IS NULL
  `).all() as IngredientRow[];

  const translations = rows.filter((row) =>
    latinPattern.test(row.name) && !chinesePattern.test(row.name)
  );

  let translatedCount = 0;
  const translatedRows = await mapWithConcurrency(translations, 4, async (row, index) => {
    const { product, brand } = splitProductAndBrand(row.name);
    const translatedProduct = await translateToChinese(product);
    const meaningfulTranslation =
      chinesePattern.test(translatedProduct) && translatedProduct.toLocaleLowerCase() !== product.toLocaleLowerCase();
    const fallback = categoryFallbacks[row.category || ''] || '进口食品';
    const localizedProduct = meaningfulTranslation ? translatedProduct : fallback;
    const displayBrand = brand || (!meaningfulTranslation ? product : null);
    const localizedName = displayBrand ? `${localizedProduct}（${displayBrand}）` : localizedProduct;
    if ((index + 1) % 100 === 0 || index + 1 === translations.length) {
      console.log(`已翻译 ${index + 1}/${translations.length}`);
    }
    return { ...row, localizedName };
  });

  const update = db.prepare(`
    UPDATE ingredients_library
    SET name = ?, original_name = COALESCE(original_name, ?)
    WHERE id = ?
  `);
  const transaction = db.transaction(() => {
    for (const row of rows) {
      if (!chinesePattern.test(row.name)) continue;
      const simplified = toSimplified(row.name);
      if (simplified !== row.name || !row.original_name) {
        update.run(simplified, row.name, row.id);
      }
    }
    for (const row of translatedRows) {
      update.run(row.localizedName, row.name, row.id);
      translatedCount += 1;
    }
  });
  transaction();

  console.log(JSON.stringify({
    translated: translatedCount,
    simplifiedOrOriginalNamePreserved: rows.length - translations.length,
  }));
  db.close();
}

main().catch((error) => {
  console.error(error);
  db.close();
  process.exitCode = 1;
});
