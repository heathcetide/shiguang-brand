#!/usr/bin/env node
/**
 * Expand demo data: more community posts, health logs, and personal inventory
 * for local_user + six demo personas. Uses real Unsplash food photos.
 *
 *   DEMO_USER_PASSWORD='DemoPassword1234' node server/scripts/seed-demo-community.mjs --reset-posts
 *   node server/scripts/seed-demo-rich.mjs
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || resolve(__dirname, '../data/dietdigidose.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

for (const [table, column, ddl] of [
  ['community_posts', 'ip_location', 'TEXT'],
  ['community_posts', 'nickname', 'TEXT'],
  ['community_posts', 'image_urls', 'TEXT'],
  ['diet_records', 'protein', 'REAL'],
  ['diet_records', 'carbs', 'REAL'],
  ['diet_records', 'fat', 'REAL'],
  ['diet_records', 'amount', 'TEXT'],
  ['diet_records', 'recorded_time', 'TEXT'],
  ['inventory_items', 'quantity_value', 'TEXT'],
  ['inventory_items', 'quantity_unit', 'TEXT'],
  ['inventory_items', 'note', 'TEXT'],
]) ensureColumn(table, column, ddl);

const emails = [
  'demo@dietdigidose.test',
  'chef-david@dietdigidose.test',
  'family-kitchen@dietdigidose.test',
  'nutritionist-lisa@dietdigidose.test',
  'fitness-jack@dietdigidose.test',
  'diet-helper@dietdigidose.test',
  'local_user@example.test',
];

const users = db.prepare(`SELECT id, email, username, nickname, avatar_url FROM users WHERE email IN (${emails.map(() => '?').join(',')})`).all(...emails);
const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
const demo = byEmail['demo@dietdigidose.test'];
const local = byEmail['local_user@example.test'];
const chef = byEmail['chef-david@dietdigidose.test'];
const family = byEmail['family-kitchen@dietdigidose.test'];
const lisa = byEmail['nutritionist-lisa@dietdigidose.test'];
const jack = byEmail['fitness-jack@dietdigidose.test'];
const helper = byEmail['diet-helper@dietdigidose.test'];

if (!demo) {
  console.error('Run seed-demo-community.mjs first');
  process.exit(1);
}

const img = {
  salad: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/22-55b818b511194e24.jpg',
  avocado: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/2-7a7cfe92f7dc2669.jpg',
  eggs: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/18-0d8deb56bcb3f81f.jpg',
  salmon: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/17-16e080151c72d692.jpg',
  salmon2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
  bowl: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/24-8d5440697f684f9c.jpg',
  chicken: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/8-60b9ba0af6c86ee4.jpg',
  veggies: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/4-4527b70345251b6f.jpg',
  fruit: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
  yogurt: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/16-eeb895d82f707c27.jpg',
  bread: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/4-4527b70345251b6f.jpg',
  soup: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
  tofu: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/19-cc9e40c0776c5379.jpg',
  bento: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/14-11e5548d948e974a.jpg',
  pasta: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/1-332bf9a8368f7d52.jpg',
  nuts: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/16-eeb895d82f707c27.jpg',
  coffee: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/24-8d5440697f684f9c.jpg',
  berries: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/18-0d8deb56bcb3f81f.jpg',
  rice: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/23-8b49fafd22d33c53.jpg',
  tomato: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/5-85bd64f2e8e84acb.jpg',
  mushroom: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/17-16e080151c72d692.jpg',
  greens: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/22-55b818b511194e24.jpg',
  milk: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/22-55b818b511194e24.jpg',
  fish: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
  lemon: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/6-c8899ba029dd03fd.jpg',
  ginger: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/5-85bd64f2e8e84acb.jpg',
  garlic: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
  onion: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/6-c8899ba029dd03fd.jpg',
  potato: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/6-c8899ba029dd03fd.jpg',
  egg: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/7-d05ac69f94763d6f.jpg',
  oat: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
};

const cities = ['上海', '杭州', '苏州', '南京', '深圳', '广州', '成都', '北京', '武汉', '厦门', '重庆', '青岛'];
const now = Date.now();
const isoOffset = (hours) => new Date(now + hours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
const dayKey = (daysAgo) => {
  const d = new Date(now - daysAgo * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const expireIn = (days) => dayKey(-days);

// Fill missing ip_location on existing posts
db.prepare(`UPDATE community_posts SET ip_location=? WHERE id=? AND (ip_location IS NULL OR ip_location='')`);
const postsWithoutLoc = db.prepare(`SELECT id FROM community_posts WHERE ip_location IS NULL OR ip_location=''`).all();
const setLoc = db.prepare(`UPDATE community_posts SET ip_location=? WHERE id=?`);
postsWithoutLoc.forEach((row, i) => setLoc.run(cities[i % cities.length], row.id));

// Sync nickname from users onto posts when blank
db.exec(`
  UPDATE community_posts
  SET nickname = (
    SELECT COALESCE(NULLIF(u.nickname,''), u.username) FROM users u WHERE u.id = community_posts.user_id
  )
  WHERE nickname IS NULL OR nickname=''
`);

const extraPosts = [
  { user: demo, category: '寻味', content: '#寻味 午后轻食：烤南瓜配希腊酸奶，甜而不腻，减脂日也能有仪式感。', images: [img.veggies, img.yogurt], hours: 0.8, city: '上海' },
  { user: chef, category: '寻味', content: '#控糖 早餐第二弹：全麦吐司+水煮蛋+番茄，桌边配了手冲咖啡。@健康体验家 一起坚持。', images: [img.avocado, img.eggs, img.coffee], hours: 2.1, city: '杭州' },
  { user: jack, category: '寻味', content: '胸训后补给：香煎鸡胸配西兰花糙米，蛋白 42g。#高蛋白 #健身餐', images: [img.chicken, img.bowl], hours: 3.4, city: '深圳' },
  { user: family, category: '寻味', content: '周末亲子烘焙：全麦香蕉面包出炉，孩子自己抹无糖花生酱。#家庭餐桌', images: [img.bread, img.nuts], hours: 5.2, city: '苏州' },
  { user: lisa, category: '寻味', content: '素食周分享：香煎豆腐菌菇盖浇饭，豆类+维C蔬果一起更友好。#素食', images: [img.tofu, img.mushroom, img.greens], hours: 6.5, city: '北京' },
  { user: helper, category: '寻味', content: '办公室便当复盘：三色杂粮饭+清炒时蔬+卤鸡腿，加热也不糊。#便当', images: [img.bento, img.rice], hours: 8.0, city: '广州' },
  { user: demo, category: '榜单', content: '#榜单 本周冰箱清库存实测：西兰花、口蘑、鸡蛋周转最快，浪费率最低。', images: [img.greens, img.egg], hours: 1.5, city: '上海' },
  { user: jack, category: '榜单', content: '便利店增肌加餐 TOP：即食鸡胸、无糖希腊酸奶、水煮蛋、卤毛豆、坚果小包。#高蛋白', images: [img.chicken, img.yogurt, img.nuts], hours: 4.0, city: '深圳' },
  { user: lisa, category: '榜单', content: '缺铁友好食材榜：菠菜、黑豆、豆腐、南瓜籽——记得搭配柠檬或番茄。#营养问答', images: [img.greens, img.lemon, img.tofu], hours: 7.2, city: '北京' },
  { user: chef, category: '活动', content: '#15分钟快手健康晚餐接力 今晚【蒜香口蘑煎鸡胸】，下一位接龙！', images: [img.chicken, img.mushroom, img.garlic], hours: 1.1, city: '杭州', eventStart: isoOffset(-6), eventEnd: isoOffset(24 * 5) },
  { user: helper, category: '活动', content: '#自制低卡办公室便当大赛 Day3：番茄牛肉杂粮碗已打卡。', images: [img.bento, img.tomato], hours: 2.6, city: '广州', eventStart: isoOffset(-48), eventEnd: isoOffset(24 * 4) },
  { user: family, category: '活动', content: '#冰箱清库存挑战 洋葱土豆炖鸡腿，一锅出两天晚餐。', images: [img.onion, img.chicken], hours: 9.0, city: '苏州', eventStart: isoOffset(-12), eventEnd: isoOffset(24 * 3) },
  { user: demo, category: '问答', content: '#问答 减脂期晚餐吃杂粮饭会不会碳水太高？求配比建议。', images: [img.rice], hours: 1.8, city: '上海', question: 'open' },
  { user: jack, category: '问答', content: '练后窗口期可以喝牛乳蛋白吗？乳糖不耐受友好替代有哪些？#问答', images: [img.milk], hours: 4.5, city: '深圳', question: 'open' },
  { user: family, category: '问答', content: '孩子不爱吃青菜，有没有低油烤箱做法推荐？#家庭餐桌 #问答', images: [img.veggies], hours: 10, city: '苏州', question: 'resolved' },
  { user: lisa, category: '问答', content: '素食增肌怎么把每日蛋白补到 1.6g/kg？豆制品如何搭配谷物？#问答', images: [img.tofu, img.oat], hours: 12, city: '北京', question: 'resolved' },
  { user: local || demo, category: '寻味', content: '本地打卡：清炒时蔬豆腐 + 杂粮饭，终于把健康档案补齐了。#寻味', images: [img.tofu, img.greens, img.rice], hours: 0.3, city: '上海' },
  { user: local || demo, category: '寻味', content: '今晚空气炸锅三文鱼成功，配柠檬和口蘑。@主厨David 火候建议很管用。', images: [img.salmon, img.salmon2, img.lemon], hours: 14, city: '上海' },
].filter((p) => p.user);

const insertPost = db.prepare(`
  INSERT INTO community_posts (
    user_id, username, nickname, avatar_url, category, content, image_url, image_urls,
    likes_count, comment_count, views_count, event_start_at, event_end_at, question_status, ip_location, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
`);

const existingMarker = db.prepare(`SELECT id FROM community_posts WHERE content=? AND user_id=?`);
const insertedIds = [];
const txPosts = db.transaction(() => {
  for (const post of extraPosts) {
    if (existingMarker.get(post.content, post.user.id)) continue;
    const gallery = post.images;
    const info = insertPost.run(
      post.user.id,
      post.user.username,
      post.user.nickname || post.user.username,
      post.user.avatar_url,
      post.category,
      post.content,
      gallery[0],
      JSON.stringify(gallery),
      800 + Math.floor(Math.random() * 4200),
      post.eventStart || null,
      post.eventEnd || null,
      post.category === '问答' ? (post.question || 'open') : null,
      post.city,
      isoOffset(-(post.hours || 1)),
    );
    insertedIds.push(Number(info.lastInsertRowid));
  }
});
txPosts();

// Light interactions on new posts
const insertLike = db.prepare(`INSERT OR IGNORE INTO community_post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)`);
const insertComment = db.prepare(`
  INSERT INTO community_comments (post_id, user_id, username, nickname, avatar_url, content, likes_count, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const commenters = [demo, chef, lisa, jack, helper, family, local].filter(Boolean);
for (const postId of insertedIds) {
  for (const u of commenters) {
    if ((postId + u.id) % 2 === 0) insertLike.run(postId, u.id, isoOffset(-1));
  }
  const author = commenters[(postId + 1) % commenters.length];
  const other = commenters[(postId + 3) % commenters.length];
  if (author && other && author.id !== other.id) {
    insertComment.run(postId, other.id, other.username, other.nickname || other.username, other.avatar_url,
      '很实用，已经收藏照着做了。', 5 + (postId % 10), isoOffset(-0.5));
  }
}

db.exec(`
  UPDATE community_posts SET
    likes_count = (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = community_posts.id),
    comment_count = (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = community_posts.id)
`);

// Health profiles + logs for local_user and demo
const upsertProfile = db.prepare(`
  INSERT INTO user_health_profiles (user_id, profile_json) VALUES (?, ?)
  ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json
`);
const profiles = [
  [demo?.id, {
    version: 1,
    allergies: [{ name: '坚果', severity: 'severe' }],
    dietary_restrictions: ['低钠', '控糖'],
    medical_conditions: [],
    medications: '',
    currentMeasurements: { height_cm: { value: 165 }, weight: { value: 58.2 }, body_fat: { value: 25.8 } },
    goals: { daily_calories_target: 1600, focus: 'fat_loss' },
  }],
  [local?.id, {
    version: 1,
    allergies: [],
    dietary_restrictions: ['少油'],
    medical_conditions: [],
    medications: '',
    currentMeasurements: { height_cm: { value: 172 }, weight: { value: 68.5 }, body_fat: { value: 19.6 } },
    goals: { daily_calories_target: 2000, focus: 'maintain' },
  }],
  [jack?.id, {
    version: 1,
    allergies: [{ name: '乳糖', severity: 'moderate' }],
    dietary_restrictions: ['高蛋白'],
    medical_conditions: [],
    medications: '',
    currentMeasurements: { height_cm: { value: 178 }, weight: { value: 77.8 }, body_fat: { value: 13.9 } },
    goals: { daily_calories_target: 2800, focus: 'muscle_gain' },
  }],
];
for (const [id, profile] of profiles) {
  if (id) upsertProfile.run(id, JSON.stringify(profile));
}

const insertHealth = db.prepare(`
  INSERT INTO health_logs (user_id, weight, steps, sleep_hours, recorded_at, recorded_date, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
for (const u of [demo, local, jack].filter(Boolean)) {
  for (let day = 0; day < 10; day += 1) {
    const exists = db.prepare(`SELECT id FROM health_logs WHERE user_id=? AND recorded_date=?`).get(u.id, dayKey(day));
    if (exists) continue;
    insertHealth.run(
      u.id,
      (u.id === jack?.id ? 77.8 : u.id === local?.id ? 68.5 : 58.2) - day * 0.03,
      7200 + day * 380 + (u.id % 500),
      6.8 + (day % 3) * 0.35,
      dayKey(day),
      dayKey(day),
      isoOffset(-(day * 24)),
    );
  }
}

// Diet for local_user
if (local) {
  const insertDiet = db.prepare(`
    INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const meals = [
    ['早餐', '燕麦牛奶碗', '1碗', 340, 14, 48, 9],
    ['午餐', '鸡胸糙米饭', '1份', 520, 38, 52, 14],
    ['晚餐', '清炒时蔬豆腐', '1份', 310, 18, 20, 12],
    ['加餐', '无糖希腊酸奶', '150g', 95, 15, 6, 0],
  ];
  for (let day = 0; day < 8; day += 1) {
    meals.forEach((meal, idx) => {
      const [meal_type, food_name, amount, calories, protein, carbs, fat] = meal;
      const exists = db.prepare(`SELECT id FROM diet_records WHERE user_id=? AND recorded_at=? AND food_name=?`).get(local.id, dayKey(day), food_name);
      if (exists) return;
      insertDiet.run(local.id, meal_type, food_name, amount, calories, protein, carbs, fat, dayKey(day), `${7 + idx * 4}:20`, isoOffset(-(day * 24 + idx)));
    });
  }
}

// Inventory for local_user + demo (realistic fridge/pantry)
const inventoryTargets = [local, demo, chef, jack, family, lisa, helper].filter(Boolean);
// quantity_unit must match shared contract: g/kg/ml/l/piece/serving/bag/box/bottle/can
const inventoryCatalog = [
  { name: '鸡胸肉', category: '肉禽蛋', qty: '600', unit: 'g', display: '600g', days: 3, loc: '冷藏', image: img.chicken, note: '今晚空气炸锅用' },
  { name: '三文鱼', category: '水产', qty: '2', unit: 'piece', display: '2片', days: 2, loc: '冷藏', image: img.salmon, note: '解冻后当天吃完' },
  { name: '鸡蛋', category: '肉禽蛋', qty: '10', unit: 'piece', display: '10个', days: 12, loc: '冷藏', image: img.egg },
  { name: '西兰花', category: '蔬菜', qty: '2', unit: 'piece', display: '2颗', days: 4, loc: '冷藏', image: img.greens },
  { name: '菠菜', category: '蔬菜', qty: '1', unit: 'bag', display: '1把', days: 2, loc: '冷藏', image: img.greens },
  { name: '口蘑', category: '蔬菜', qty: '300', unit: 'g', display: '300g', days: 5, loc: '冷藏', image: img.mushroom },
  { name: '番茄', category: '蔬菜', qty: '6', unit: 'piece', display: '6个', days: 6, loc: '冷藏', image: img.tomato },
  { name: '牛油果', category: '水果', qty: '3', unit: 'piece', display: '3个', days: 4, loc: '常温', image: img.avocado },
  { name: '蓝莓', category: '水果', qty: '1', unit: 'box', display: '1盒', days: 5, loc: '冷藏', image: img.berries },
  { name: '香蕉', category: '水果', qty: '5', unit: 'piece', display: '5根', days: 4, loc: '常温', image: img.fruit },
  { name: '老豆腐', category: '豆制品', qty: '2', unit: 'box', display: '2盒', days: 5, loc: '冷藏', image: img.tofu },
  { name: '无糖希腊酸奶', category: '乳品', qty: '4', unit: 'serving', display: '4杯', days: 10, loc: '冷藏', image: img.yogurt },
  { name: '低脂牛奶', category: '乳品', qty: '1', unit: 'box', display: '1盒', days: 7, loc: '冷藏', image: img.milk },
  { name: '燕麦片', category: '主食', qty: '500', unit: 'g', display: '500g', days: 90, loc: '常温', image: img.oat },
  { name: '糙米', category: '主食', qty: '1', unit: 'kg', display: '1kg', days: 120, loc: '常温', image: img.rice },
  { name: '全麦面包', category: '主食', qty: '1', unit: 'bag', display: '1袋', days: 5, loc: '常温', image: img.bread },
  { name: '柠檬', category: '调味', qty: '4', unit: 'piece', display: '4个', days: 14, loc: '冷藏', image: img.lemon },
  { name: '生姜', category: '调味', qty: '1', unit: 'piece', display: '1块', days: 20, loc: '常温', image: img.ginger },
  { name: '大蒜', category: '调味', qty: '1', unit: 'piece', display: '1头', days: 25, loc: '常温', image: img.garlic },
  { name: '洋葱', category: '蔬菜', qty: '3', unit: 'piece', display: '3个', days: 18, loc: '常温', image: img.onion },
  { name: '无盐坚果', category: '零食', qty: '200', unit: 'g', display: '200g', days: 60, loc: '常温', image: img.nuts },
  { name: '冷冻虾仁', category: '水产', qty: '400', unit: 'g', display: '400g', days: 45, loc: '冷冻', image: img.fish },
  { name: '冷冻西兰花', category: '蔬菜', qty: '1', unit: 'bag', display: '1袋', days: 60, loc: '冷冻', image: img.greens },
  { name: '生菜', category: '蔬菜', qty: '1', unit: 'bag', display: '1袋', days: 3, loc: '冷藏', image: img.salad },
  { name: '黄瓜', category: '蔬菜', qty: '4', unit: 'piece', display: '4根', days: 5, loc: '冷藏', image: img.greens },
  { name: '胡萝卜', category: '蔬菜', qty: '5', unit: 'piece', display: '5根', days: 10, loc: '冷藏', image: img.veggies },
  { name: '土豆', category: '蔬菜', qty: '6', unit: 'piece', display: '6个', days: 14, loc: '常温', image: img.onion },
  { name: '青椒', category: '蔬菜', qty: '4', unit: 'piece', display: '4个', days: 6, loc: '冷藏', image: img.greens },
  { name: '虾仁', category: '水产', qty: '250', unit: 'g', display: '250g', days: 2, loc: '冷藏', image: img.fish },
  { name: '鸡翅中', category: '肉禽蛋', qty: '8', unit: 'piece', display: '8只', days: 3, loc: '冷藏', image: img.chicken },
  { name: '牛肉片', category: '肉禽蛋', qty: '300', unit: 'g', display: '300g', days: 2, loc: '冷藏', image: img.chicken },
  { name: '黑豆', category: '豆制品', qty: '400', unit: 'g', display: '400g', days: 180, loc: '常温', image: img.bowl },
  { name: '橄榄油', category: '调味', qty: '1', unit: 'bottle', display: '1瓶', days: 200, loc: '常温', image: img.lemon },
  { name: '番茄酱', category: '调味', qty: '1', unit: 'bottle', display: '1瓶', days: 90, loc: '冷藏', image: img.tomato },
  { name: '无糖豆浆', category: '饮品', qty: '1', unit: 'box', display: '1盒', days: 8, loc: '冷藏', image: img.milk },
  { name: '奇亚籽', category: '零食', qty: '150', unit: 'g', display: '150g', days: 150, loc: '常温', image: img.nuts },
];

const insertInv = db.prepare(`
  INSERT INTO inventory_items (
    user_id, food_name, category, quantity, quantity_value, quantity_unit,
    expiration_date, storage_location, image_url, is_available, note, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
`);

const clearInv = db.prepare(`DELETE FROM inventory_items WHERE user_id=? AND deleted_at IS NULL`);
for (const user of inventoryTargets) {
  clearInv.run(user.id);
  inventoryCatalog.forEach((item, index) => {
    // stagger stock per persona
    if ((user.id + index) % 7 === 0) return;
    insertInv.run(
      user.id,
      item.name,
      item.category,
      item.display || `${item.qty}${item.unit}`,
      item.qty,
      item.unit,
      expireIn(item.days),
      item.loc,
      item.image,
      item.note || null,
      isoOffset(-(index % 48)),
      isoOffset(-(index % 24)),
    );
  });
}

// Normalize any legacy Chinese quantity_unit values left in the DB.
const unitAliases = {
  克: 'g', 千克: 'kg', 公斤: 'kg', 毫升: 'ml', 升: 'l',
  个: 'piece', 只: 'piece', 片: 'piece', 颗: 'piece', 根: 'piece',
  头: 'piece', 块: 'piece', 把: 'piece', 杯: 'serving', 份: 'serving',
  袋: 'bag', 盒: 'box', 瓶: 'bottle', 罐: 'can',
};
const updateUnit = db.prepare(`UPDATE inventory_items SET quantity_unit=? WHERE quantity_unit=?`);
for (const [from, to] of Object.entries(unitAliases)) updateUnit.run(to, from);

const morePosts = [
  { user: demo, category: '寻味', content: '#寻味 今日清冰箱：番茄炒蛋配糙米饭，酸甜开胃还不浪费。', images: [img.tomato, img.eggs, img.rice], hours: 0.4, city: '上海' },
  { user: chef, category: '寻味', content: '夜市后的救赎晚餐：蒜香口蘑鸡胸，15 分钟出锅。#快手菜', images: [img.chicken, img.mushroom, img.garlic], hours: 1.2, city: '杭州' },
  { user: lisa, category: '寻味', content: '补铁午餐：菠菜黑豆豆腐沙拉，搭配柠檬汁吸收更好。#营养餐', images: [img.greens, img.tofu, img.lemon], hours: 2.0, city: '北京' },
  { user: jack, category: '寻味', content: '腿训日加餐：希腊酸奶碗 + 蓝莓坚果，蛋白拉满。#增肌', images: [img.yogurt, img.berries, img.nuts], hours: 2.8, city: '深圳' },
  { user: family, category: '寻味', content: '亲子早餐：全麦吐司牛油果蛋，孩子自己摆盘。#家庭餐桌', images: [img.avocado, img.bread, img.eggs], hours: 3.5, city: '苏州' },
  { user: helper, category: '寻味', content: '办公室微波便当：杂粮饭 + 清炒西兰花虾仁，加热也不干。', images: [img.bento, img.greens, img.fish], hours: 4.1, city: '广州' },
  { user: local || demo, category: '寻味', content: '空气炸锅三文鱼第二次：柠檬片盖顶，外焦里嫩。#寻味', images: [img.salmon, img.lemon], hours: 5.0, city: '上海' },
  { user: demo, category: '寻味', content: '周末brunch：燕麦碗配香蕉坚果，甜度刚好。', images: [img.oat, img.fruit, img.nuts], hours: 11, city: '上海' },
  { user: chef, category: '寻味', content: '汤品周：番茄菌菇汤，低油高纤维。#轻食', images: [img.soup, img.tomato, img.mushroom], hours: 13, city: '杭州' },
  { user: lisa, category: '寻味', content: '素食晚餐：香干青椒土豆丝，一盘搞定。', images: [img.tofu, img.veggies], hours: 15, city: '北京' },
  { user: jack, category: '寻味', content: '备餐日产物：鸡胸分装 + 杂粮饭，够吃三天。#mealprep', images: [img.chicken, img.bowl, img.rice], hours: 18, city: '深圳' },
  { user: family, category: '寻味', content: '孩子爱吃的烤蔬菜拼盘：胡萝卜南瓜西兰花一次搞定。', images: [img.veggies, img.greens], hours: 20, city: '苏州' },
  { user: helper, category: '寻味', content: '加班夜轻负担：豆腐蔬菜汤 + 半个牛油果。', images: [img.soup, img.tofu, img.avocado], hours: 22, city: '广州' },
  { user: demo, category: '榜单', content: '#榜单 减脂期早餐稳定榜：燕麦、鸡蛋、希腊酸奶、番茄、蓝莓。', images: [img.oat, img.eggs, img.yogurt], hours: 0.9, city: '上海' },
  { user: chef, category: '榜单', content: '15分钟晚餐效率榜：蒜香鸡胸、番茄炒蛋、口蘑豆腐、清炒时蔬。', images: [img.chicken, img.tomato, img.tofu], hours: 3.2, city: '杭州' },
  { user: jack, category: '榜单', content: '练后补给性价比：即食鸡胸 > 水煮蛋 > 无糖酸奶 > 牛肉干。', images: [img.chicken, img.eggs, img.yogurt], hours: 6.0, city: '深圳' },
  { user: lisa, category: '榜单', content: '膳食纤维友好清单：燕麦、黑豆、西兰花、菌菇、奇亚籽。', images: [img.oat, img.greens, img.mushroom], hours: 8.5, city: '北京' },
  { user: family, category: '榜单', content: '孩子挑食也能吃：烤蔬、杂粮饭、豆腐丸、香蕉酸奶。', images: [img.veggies, img.rice, img.yogurt], hours: 14, city: '苏州' },
  { user: helper, category: '榜单', content: '办公室便当抗糊榜：杂粮饭、卤鸡腿、焯西兰花、凉拌豆腐。', images: [img.bento, img.chicken, img.tofu], hours: 16, city: '广州' },
  { user: demo, category: '活动', content: '#一周不点外卖挑战 Day2：午餐自带鸡胸糙米碗。', images: [img.bowl, img.chicken], hours: 1.0, city: '上海', eventStart: isoOffset(-24), eventEnd: isoOffset(24 * 6) },
  { user: chef, category: '活动', content: '#空气炸锅接力赛 本周主题：低油脆口蔬菜。欢迎晒图！', images: [img.veggies, img.greens], hours: 2.4, city: '杭州', eventStart: isoOffset(-8), eventEnd: isoOffset(24 * 7) },
  { user: jack, category: '活动', content: '#增肌厨房打卡 今日蛋白目标 160g，已完成胸训后补给。', images: [img.yogurt, img.chicken], hours: 5.5, city: '深圳', eventStart: isoOffset(-30), eventEnd: isoOffset(24 * 4) },
  { user: lisa, category: '活动', content: '#补铁周 菠菜柠檬豆腐已打卡，欢迎交换菜谱。', images: [img.greens, img.lemon, img.tofu], hours: 7.0, city: '北京', eventStart: isoOffset(-10), eventEnd: isoOffset(24 * 5) },
  { user: family, category: '活动', content: '#亲子健康早餐周 第三天：全麦吐司拼盘。', images: [img.bread, img.avocado, img.eggs], hours: 9.5, city: '苏州', eventStart: isoOffset(-50), eventEnd: isoOffset(24 * 3) },
  { user: helper, category: '活动', content: '#低卡便当大赛 本周主题：一汤一素一蛋白。', images: [img.bento, img.soup], hours: 12, city: '广州', eventStart: isoOffset(-20), eventEnd: isoOffset(24 * 8) },
  { user: local || demo, category: '活动', content: '#冰箱清库存挑战 还剩口蘑鸡蛋番茄，求今晚菜单。', images: [img.mushroom, img.eggs, img.tomato], hours: 17, city: '上海', eventStart: isoOffset(-4), eventEnd: isoOffset(24 * 2) },
  { user: demo, category: '问答', content: '#问答 晚饭只想吃 400kcal 左右，有没有饱腹感强的组合？', images: [img.salad], hours: 0.6, city: '上海', question: 'open' },
  { user: chef, category: '问答', content: '空气炸锅鸡胸总是干，喷油还是泡盐水更稳？#问答', images: [img.chicken], hours: 3.0, city: '杭州', question: 'open' },
  { user: jack, category: '问答', content: '夜间加餐吃希腊酸奶会不会影响脂肪氧化？#问答', images: [img.yogurt], hours: 4.8, city: '深圳', question: 'open' },
  { user: lisa, category: '问答', content: '素食者补铁除了菠菜还有哪些日常可做？需要搭配维C吗？', images: [img.greens, img.lemon], hours: 7.8, city: '北京', question: 'resolved' },
  { user: family, category: '问答', content: '幼儿园便当怎么保证两小时后还好吃又不油？#问答', images: [img.bento], hours: 10.5, city: '苏州', question: 'open' },
  { user: helper, category: '问答', content: '微波加热杂粮饭总是硬，有没有加水比例建议？', images: [img.rice], hours: 13.2, city: '广州', question: 'resolved' },
  { user: local || demo, category: '问答', content: '今天已吃偏多，晚上只想用库存消化，鸡胸西兰花够吗？', images: [img.chicken, img.greens], hours: 19, city: '上海', question: 'open' },
].filter((p) => p.user);

const moreInserted = [];
const txMore = db.transaction(() => {
  for (const post of morePosts) {
    if (existingMarker.get(post.content, post.user.id)) continue;
    const gallery = post.images;
    const info = insertPost.run(
      post.user.id,
      post.user.username,
      post.user.nickname || post.user.username,
      post.user.avatar_url,
      post.category,
      post.content,
      gallery[0],
      JSON.stringify(gallery),
      900 + Math.floor(Math.random() * 5000),
      post.eventStart || null,
      post.eventEnd || null,
      post.category === '问答' ? (post.question || 'open') : null,
      post.city,
      isoOffset(-(post.hours || 1)),
    );
    moreInserted.push(Number(info.lastInsertRowid));
  }
});
txMore();
insertedIds.push(...moreInserted);

for (const postId of moreInserted) {
  for (const u of commenters) {
    if ((postId + u.id) % 3 !== 0) insertLike.run(postId, u.id, isoOffset(-((postId + u.id) % 20)));
  }
  const a = commenters[(postId + 2) % commenters.length];
  const b = commenters[(postId + 4) % commenters.length];
  if (a && b && a.id !== b.id) {
    insertComment.run(postId, b.id, b.username, b.nickname || b.username, b.avatar_url,
      ['收藏了，今晚就做。', '这个搭配很稳，已加入备餐清单。', '感谢分享，正好冰箱有同款食材。'][postId % 3],
      3 + (postId % 12), isoOffset(-0.2));
  }
}

db.exec(`
  UPDATE community_posts SET
    likes_count = (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = community_posts.id),
    comment_count = (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = community_posts.id)
`);

// Seed a practical Chinese ingredients library if empty / sparse.
const ingredientCount = db.prepare(`SELECT COUNT(*) AS c FROM ingredients_library`).get().c;
const ingredientRows = [
  ['鸡胸肉', '肉禽蛋', 'g', 133, 24.5, 1.9, 2.5],
  ['鸡蛋', '肉禽蛋', 'g', 144, 13.3, 8.8, 2.8],
  ['三文鱼', '水产', 'g', 208, 20.4, 13.4, 0],
  ['虾仁', '水产', 'g', 93, 18.6, 1.4, 0.8],
  ['西兰花', '蔬菜', 'g', 34, 2.8, 0.4, 7.0],
  ['菠菜', '蔬菜', 'g', 24, 2.6, 0.3, 3.6],
  ['番茄', '蔬菜', 'g', 18, 0.9, 0.2, 3.9],
  ['口蘑', '蔬菜', 'g', 22, 3.1, 0.3, 3.3],
  ['黄瓜', '蔬菜', 'g', 15, 0.7, 0.1, 2.9],
  ['胡萝卜', '蔬菜', 'g', 41, 0.9, 0.2, 9.6],
  ['土豆', '蔬菜', 'g', 77, 2.0, 0.1, 17.5],
  ['洋葱', '蔬菜', 'g', 40, 1.1, 0.1, 9.3],
  ['生菜', '蔬菜', 'g', 15, 1.4, 0.2, 2.9],
  ['青椒', '蔬菜', 'g', 20, 0.9, 0.2, 4.6],
  ['豆腐', '豆制品', 'g', 76, 8.1, 4.8, 1.9],
  ['黑豆', '豆制品', 'g', 341, 21.6, 0.7, 62.4],
  ['燕麦片', '主食', 'g', 367, 15.0, 6.5, 62.0],
  ['糙米', '主食', 'g', 370, 7.4, 2.2, 77.2],
  ['全麦面包', '主食', 'g', 247, 13.0, 4.2, 41.3],
  ['香蕉', '水果', 'g', 89, 1.1, 0.3, 22.8],
  ['蓝莓', '水果', 'g', 57, 0.7, 0.3, 14.5],
  ['牛油果', '水果', 'g', 160, 2.0, 14.7, 8.5],
  ['柠檬', '水果', 'g', 29, 1.1, 0.3, 9.3],
  ['无糖希腊酸奶', '乳品', 'g', 59, 10.2, 0.4, 3.6],
  ['低脂牛奶', '乳品', 'g', 42, 3.4, 1.0, 5.0],
  ['无糖豆浆', '饮品', 'g', 31, 3.0, 1.6, 1.2],
  ['无盐坚果混合', '零食', 'g', 607, 20.0, 54.0, 21.0],
  ['奇亚籽', '零食', 'g', 486, 16.5, 30.7, 42.1],
  ['橄榄油', '调味', 'g', 884, 0, 100, 0],
  ['生姜', '调味', 'g', 80, 1.8, 0.8, 17.8],
  ['大蒜', '调味', 'g', 149, 6.4, 0.5, 33.1],
  ['鸡翅中', '肉禽蛋', 'g', 203, 17.5, 14.5, 0],
  ['牛肉片', '肉禽蛋', 'g', 125, 20.0, 4.5, 0],
  ['冷冻虾仁', '水产', 'g', 85, 18.0, 0.8, 0.5],
  ['南瓜', '蔬菜', 'g', 26, 1.0, 0.1, 6.5],
  ['紫薯', '主食', 'g', 82, 1.6, 0.2, 20.0],
  ['玉米', '主食', 'g', 106, 3.1, 1.2, 22.8],
  ['苹果', '水果', 'g', 52, 0.3, 0.2, 13.8],
  ['橙子', '水果', 'g', 47, 0.9, 0.1, 11.8],
  ['草莓', '水果', 'g', 32, 0.7, 0.3, 7.7],
];
if (ingredientCount < 30) {
  const insertIngredient = db.prepare(`
    INSERT INTO ingredients_library (
      name, category, unit, calories_100g, protein_100g, fat_100g, carbs_100g,
      source, source_version, data_license, quality_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'demo_seed', 'demo-1', 'Demo', 'trusted')
  `);
  const existsIngredient = db.prepare(`SELECT id FROM ingredients_library WHERE name=? LIMIT 1`);
  for (const row of ingredientRows) {
    if (existsIngredient.get(row[0])) continue;
    insertIngredient.run(...row);
  }
}

const summary = {
  db: dbPath,
  extra_posts: insertedIds.length,
  more_posts: moreInserted.length,
  posts_total: db.prepare(`SELECT COUNT(*) AS c FROM community_posts`).get().c,
  by_category: db.prepare(`SELECT category, COUNT(*) AS c FROM community_posts GROUP BY category`).all(),
  ingredients: db.prepare(`SELECT COUNT(*) AS c FROM ingredients_library`).get().c,
  inventory: inventoryTargets.map((u) => ({
    email: u.email,
    count: db.prepare(`SELECT COUNT(*) AS c FROM inventory_items WHERE user_id=? AND deleted_at IS NULL`).get(u.id).c,
  })),
  health_profiles: db.prepare(`SELECT COUNT(*) AS c FROM user_health_profiles`).get().c,
  diet_local: local ? db.prepare(`SELECT COUNT(*) AS c FROM diet_records WHERE user_id=?`).get(local.id).c : 0,
};

console.log(JSON.stringify(summary, null, 2));
db.close();
