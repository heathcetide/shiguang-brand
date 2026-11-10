/** 台湾食药署食品营养成分资料集（OGDL v1.0）导入器。 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db, initDatabase } from '../src/storage/db.js';

const url = 'https://data.fda.gov.tw/opendata/exportDataList.do?InfoId=20&logType=2&method=ExportData';
const work = path.join(tmpdir(), 'dietdigidose-taiwan-fda');
const zip = path.join(work, 'nutrition.zip');
const csv = path.join(work, '20_2.csv');

function parseCsv(line: string) {
  const values: string[] = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value); return values;
}
function valueOf(raw: string) { const value = Number(raw); return Number.isFinite(value) ? value : 0; }
function macro(nutrients: Record<string, { value: number; unit: string }>, pattern: RegExp) {
  const match = Object.entries(nutrients).find(([name]) => pattern.test(name)); return match?.[1].value || 0;
}

async function main() {
  initDatabase(); mkdirSync(work, { recursive: true });
  if (!existsSync(csv)) {
    const response = await fetch(url); if (!response.ok || !response.body) throw new Error(`下载台湾食药署资料失败：${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(zip));
    execFileSync('unzip', ['-o', zip, '-d', work], { stdio: 'ignore' });
  }
  const insert = db.prepare(`INSERT INTO ingredients_library (name, category, calories_100g, protein_100g, carbs_100g, fat_100g, source, micronutrients_json, data_license) VALUES (?, ?, ?, ?, ?, ?, 'taiwan_fda', ?, 'OGDL-1.0')`);
  const exists = db.prepare(`SELECT id FROM ingredients_library WHERE name = ? AND source = 'taiwan_fda' AND deleted_at IS NULL LIMIT 1`);
  const update = db.prepare(`UPDATE ingredients_library SET calories_100g = ?, protein_100g = ?, carbs_100g = ?, fat_100g = ?, micronutrients_json = ? WHERE id = ?`);
  let header: string[] = []; let currentId = ''; let name = ''; let category = ''; let nutrients: Record<string, { value: number; unit: string }> = {}; let added = 0;
  const flush = () => {
    if (!currentId || !name) return;
    const values = [macro(nutrients, /熱量|热量/), macro(nutrients, /粗蛋白|^蛋白質$|^蛋白质$/), macro(nutrients, /總碳水|总碳水|^碳水/), macro(nutrients, /粗脂肪|^脂肪$/), JSON.stringify(nutrients)] as const;
    const row = exists.get(name) as { id: number } | undefined;
    if (row) update.run(...values, row.id);
    else { insert.run(name, category || '其他食品', values[0], values[1], values[2], values[3], values[4]); added += 1; }
  };
  const rl = createInterface({ input: createReadStream(csv, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const row = parseCsv(line.replace(/^\uFEFF/, ''));
    if (!header.length) { header = row; continue; }
    const at = (key: string) => row[header.indexOf(key)] || '';
    const id = at('整合編號');
    if (id !== currentId) { flush(); currentId = id; name = at('樣品名稱') || at('俗名'); category = at('食品分類'); nutrients = {}; }
    const nutrient = at('分析項'); const amount = at('每100克含量');
    if (nutrient && amount && amount !== 'Tr') nutrients[nutrient] = { value: valueOf(amount), unit: at('含量單位') || 'g' };
  }
  flush(); console.log(JSON.stringify({ added })); db.close(); rmSync(work, { recursive: true, force: true });
}
main().catch((error) => { console.error(error); db.close(); process.exitCode = 1; });
