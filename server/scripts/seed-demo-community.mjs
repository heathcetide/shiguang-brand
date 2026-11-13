#!/usr/bin/env node
/**
 * Seed interconnected demo community + diet data into the shared SQLite DB
 * used by Go (:9090) and Express. Idempotent for the six demo personas.
 *
 * Usage:
 *   DEMO_USER_PASSWORD='DemoPassword1234' node server/scripts/seed-demo-community.mjs
 *   node server/scripts/seed-demo-community.mjs --reset-posts
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH
  || resolve(__dirname, '../data/dietdigidose.db');
const password = process.env.DEMO_USER_PASSWORD || 'DemoPassword1234';
const resetPosts = process.argv.includes('--reset-posts');

if (password.length < 12) {
  console.error('DEMO_USER_PASSWORD must be at least 12 characters');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

for (const [table, column, ddl] of [
  ['community_posts', 'username', 'TEXT'],
  ['community_posts', 'nickname', 'TEXT'],
  ['community_posts', 'avatar_url', 'TEXT'],
  ['community_posts', 'image_url', 'TEXT'],
  ['community_posts', 'image_urls', 'TEXT'],
  ['community_posts', 'category', 'TEXT'],
  ['community_posts', 'deleted_at', 'TEXT'],
  ['community_posts', 'likes_count', 'INTEGER DEFAULT 0'],
  ['community_posts', 'comment_count', 'INTEGER DEFAULT 0'],
  ['community_posts', 'views_count', 'INTEGER DEFAULT 0'],
  ['community_posts', 'event_start_at', 'TEXT'],
  ['community_posts', 'event_end_at', 'TEXT'],
  ['community_posts', 'question_status', 'TEXT'],
  ['community_posts', 'accepted_comment_id', 'INTEGER'],
  ['community_comments', 'nickname', 'TEXT'],
  ['community_comments', 'avatar_url', 'TEXT'],
  ['community_comments', 'image_url', 'TEXT'],
  ['diet_records', 'amount', 'TEXT'],
  ['diet_records', 'protein', 'REAL'],
  ['diet_records', 'carbs', 'REAL'],
  ['diet_records', 'fat', 'REAL'],
  ['diet_records', 'image_url', 'TEXT'],
  ['diet_records', 'recorded_time', 'TEXT'],
]) {
  ensureColumn(table, column, ddl);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS community_event_participants (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS community_post_likes (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS community_follows (
    follower_id INTEGER NOT NULL,
    followed_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followed_id)
  );
  CREATE TABLE IF NOT EXISTS community_checkins (
    user_id INTEGER NOT NULL,
    date_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, date_key)
  );
`);

const hash = bcrypt.hashSync(password, 10);

const USERS = [
  {
    key: 'demo',
    email: 'demo@dietdigidose.test',
    username: 'demo',
    nickname: '健康体验家',
    bio: '减脂中 · 重度坚果过敏 · 记录每一餐的日常',
    avatar: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/24-8d5440697f684f9c.jpg',
    expert: 0,
  },
  {
    key: 'chef_david',
    email: 'chef-david@dietdigidose.test',
    username: 'chef_david',
    nickname: '主厨David',
    bio: '控糖控盐家常菜 · 地中海风味慢炖',
    avatar: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/15-d28ea95061a894bd.jpg',
    expert: 0,
  },
  {
    key: 'family_kitchen',
    email: 'family-kitchen@dietdigidose.test',
    username: 'family_kitchen',
    nickname: '元气烘焙日记',
    bio: '蛋奶素家庭餐桌 · 周末烘焙与冰箱清库存',
    avatar: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/6-c8899ba029dd03fd.jpg',
    expert: 0,
  },
  {
    key: 'nutritionist_lisa',
    email: 'nutritionist-lisa@dietdigidose.test',
    username: 'nutritionist_lisa',
    nickname: '注册营养师Lisa',
    bio: '注册营养师 · 严格素食与缺铁场景答疑',
    avatar: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/18-0d8deb56bcb3f81f.jpg',
    expert: 1,
  },
  {
    key: 'fitness_jack',
    email: 'fitness-jack@dietdigidose.test',
    username: 'fitness_jack',
    nickname: '健身达人Jack',
    bio: '增肌训练餐 · 乳糖不耐受友好高蛋白',
    avatar: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/3-b13629e05ca2708a.jpg',
    expert: 0,
  },
  {
    key: 'diet_helper',
    email: 'diet-helper@dietdigidose.test',
    username: 'diet_helper',
    nickname: '减脂小助手',
    bio: '便当与控糖加餐整理 · 办公室打工人补给站',
    avatar: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/7-d05ac69f94763d6f.jpg',
    expert: 0,
  },
];

const findByEmail = db.prepare('SELECT id FROM users WHERE email=?');
const findByUsername = db.prepare('SELECT id FROM users WHERE username=?');
const updateUser = db.prepare(`
  UPDATE users SET email=@email, password_hash=@password_hash, nickname=@nickname,
    avatar_url=@avatar_url, bio=@bio, is_verified_expert=@expert, must_change_password=0
  WHERE id=@id
`);
const insertUser = db.prepare(`
  INSERT INTO users (username, email, password_hash, nickname, avatar_url, bio, role, must_change_password, session_version, is_disabled, is_verified_expert, email_verified_at)
  VALUES (@username, @email, @password_hash, @nickname, @avatar_url, @bio, 'user', 0, 1, 0, @expert, CURRENT_TIMESTAMP)
`);

const ids = {};
for (const u of USERS) {
  const payload = {
    username: u.username,
    email: u.email,
    password_hash: hash,
    nickname: u.nickname,
    avatar_url: u.avatar,
    bio: u.bio,
    expert: u.expert,
  };
  const byEmail = findByEmail.get(u.email);
  const byUsername = findByUsername.get(u.username);
  if (byEmail) {
    updateUser.run({ ...payload, id: byEmail.id });
    ids[u.key] = byEmail.id;
  } else if (byUsername) {
    updateUser.run({ ...payload, id: byUsername.id });
    ids[u.key] = byUsername.id;
  } else {
    const info = insertUser.run(payload);
    ids[u.key] = Number(info.lastInsertRowid);
  }
}

const local = findByEmail.get('local_user@example.test');
if (local) ids.local = local.id;

const img = {
  salad: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/22-55b818b511194e24.jpg',
  salad2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/19-cc9e40c0776c5379.jpg',
  avocadoToast: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/2-7a7cfe92f7dc2669.jpg',
  avocado2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/23-8b49fafd22d33c53.jpg',
  pantry: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/8-60b9ba0af6c86ee4.jpg',
  salmon: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/17-16e080151c72d692.jpg',
  salmon2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
  smoothie: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/11-7c23257e9c1c3966.jpg',
  smoothie2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/4-4527b70345251b6f.jpg',
  bowl: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/24-8d5440697f684f9c.jpg',
  bowl2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/23-8b49fafd22d33c53.jpg',
  chicken: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/8-60b9ba0af6c86ee4.jpg',
  chicken2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/21-f61e6c4c8c52b11d.jpg',
  yogurt: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/16-eeb895d82f707c27.jpg',
  yogurt2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/16-eeb895d82f707c27.jpg',
  oliveOil: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/9-31dc18468d369600.jpg',
  veggies: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/4-4527b70345251b6f.jpg',
  veggies2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/22-55b818b511194e24.jpg',
  bread: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/4-4527b70345251b6f.jpg',
  bread2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/8-60b9ba0af6c86ee4.jpg',
  soup: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
  soup2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/7-d05ac69f94763d6f.jpg',
  water: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/22-55b818b511194e24.jpg',
  bento: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/14-11e5548d948e974a.jpg',
  bento2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/23-8b49fafd22d33c53.jpg',
  stretch: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/20-138ca1e98f8c7263.jpg',
  steak: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/16-eeb895d82f707c27.jpg',
  pasta: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/1-332bf9a8368f7d52.jpg',
  pasta2: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/23-8b49fafd22d33c53.jpg',
  nuts: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/16-eeb895d82f707c27.jpg',
  mealPrep: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/9-31dc18468d369600.jpg',
  shrimp: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/3-b13629e05ca2708a.jpg',
  pumpkin: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/3-b13629e05ca2708a.jpg',
  gym: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/11-7c23257e9c1c3966.jpg',
  grains: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/10-ceb1b1cf6b227111.jpg',
  snack: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/3-b13629e05ca2708a.jpg',
  tofu: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/19-cc9e40c0776c5379.jpg',
  eggs: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/18-0d8deb56bcb3f81f.jpg',
  fruit: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/13-8e1c8d158fe448c1.jpg',
  coffee: 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/24-8d5440697f684f9c.jpg',
};

function userMeta(key) {
  const u = USERS.find((item) => item.key === key);
  return { id: ids[key], username: u.username, nickname: u.nickname, avatar: u.avatar };
}

const now = Date.now();
const isoOffset = (hours) => new Date(now + hours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
const dayKey = (daysAgo) => {
  const d = new Date(now - daysAgo * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const POSTS = [
  // 寻味 — 与 demo / jack 的饮食记录互相呼应
  { author: 'demo', category: '寻味', content: '今晚的羽衣甘蓝鸡胸沙拉：特级橄榄油+柠檬汁，膳食纤维拉满。@注册营养师Lisa 说的「先纤维后蛋白」试下来真的更稳。', image: img.salad, images: [img.salad, img.salad2], hoursAgo: 1.2, views: 1280, food: '羽衣甘蓝鸡胸沙拉' },
  { author: 'chef_david', category: '寻味', content: '控糖早餐：全麦吐司配牛油果和水煮蛋，少油少盐，配番茄更开胃。适合忙碌工作日。@健康体验家 你那份减脂打卡可以参考这个。', image: img.avocadoToast, images: [img.avocadoToast, img.eggs], hoursAgo: 3, views: 2460, food: '全麦吐司配牛油果' },
  { author: 'family_kitchen', category: '寻味', content: '冰箱清库存成功：香煎豆腐配菌菇，低脂下饭。孕期餐桌坚持彻底熟制，今晚全家光盘。', image: img.tofu, images: [img.tofu, img.soup2], hoursAgo: 5, views: 980 },
  { author: 'fitness_jack', category: '寻味', content: '练后补给碗：牛肉彩椒糙米饭约 38g 蛋白，乳糖不耐受也能安心吃。训练后 40 分钟内吃完。', image: img.bowl, images: [img.bowl, img.bowl2], hoursAgo: 7, views: 3120, food: '牛肉彩椒糙米饭' },
  { author: 'nutritionist_lisa', category: '寻味', content: '素食高蛋白灵感：烤虾仁换成老豆腐也成立——重点是配色与豆类互补。缺铁场景记得搭配维C蔬果。', image: img.shrimp, images: [img.shrimp, img.fruit], hoursAgo: 10, views: 1870 },
  { author: 'diet_helper', category: '寻味', content: '办公室低卡宵夜：海苔豆腐汤+一小份毛豆，温暖有咀嚼感还不撑。加班党可冲。', image: img.soup, images: [img.soup, img.soup2], hoursAgo: 14, views: 760 },
  { author: 'chef_david', category: '寻味', content: '15 分钟番茄虾仁全麦意面：番茄酱少油快炒，晚归也能吃得轻盈。酱汁用了昨晚剩余番茄。', image: img.pasta, images: [img.pasta, img.pasta2], hoursAgo: 18, views: 2210, food: '番茄虾仁意面' },
  { author: 'demo', category: '寻味', content: '慢炖香草番茄鸡胸：锁住肉汁不柴，配黑米饭是我这周最稳的一餐。明天继续 #30天减脂餐早安打卡。', image: img.chicken, images: [img.chicken, img.chicken2], hoursAgo: 26, views: 1540, food: '香草番茄鸡胸' },
  { author: 'family_kitchen', category: '寻味', content: '无糖香蕉燕麦松饼：香蕉+鸡蛋+燕麦，周末早餐香到邻居敲门。孩子也能一起吃。', image: img.bread, images: [img.bread, img.bread2], hoursAgo: 30, views: 2890 },
  { author: 'fitness_jack', category: '寻味', content: '空气炸锅迷迭香烤三文鱼配口蘑：180℃ 12 分钟，油脂渗进口蘑。练后 omega-3 补给。', image: img.salmon, images: [img.salmon, img.salmon2], hoursAgo: 36, views: 4010, food: '烤三文鱼口蘑' },
  { author: 'diet_helper', category: '寻味', content: '蓝莓奇亚籽燕麦杯冷藏一夜，口感像甜品，通勤加餐刚刚好。配黑咖啡更清醒。', image: img.smoothie, images: [img.smoothie, img.smoothie2, img.coffee], hoursAgo: 42, views: 1330 },
  { author: 'chef_david', category: '寻味', content: '一锅番茄牛肉蔬菜汤分装好了，工作日午餐加热即食，控钠用香料提味。@减脂小助手 办公室党可抄作业。', image: img.soup, images: [img.soup, img.mealPrep], hoursAgo: 50, views: 1760, food: '番茄牛肉蔬菜汤' },
  { author: 'demo', category: '寻味', content: '无糖希腊酸奶配蓝莓：晚间加餐 90 kcal，蛋白质补到 15g。饿的时候先喝水再决定要不要加餐。', image: img.yogurt, images: [img.yogurt, img.yogurt2], hoursAgo: 9, views: 1120, food: '无糖希腊酸奶' },
  { author: 'fitness_jack', category: '寻味', content: '训练日早晨：鸡蛋燕麦碗，慢碳水+完整蛋白。今天腿日，碳水稍加到 55g。', image: img.eggs, images: [img.eggs, img.grains], hoursAgo: 11, views: 1980, food: '鸡蛋燕麦碗' },

  // 榜单
  { author: 'diet_helper', category: '榜单', content: '本周便利店控糖加餐热度榜：无糖高纤豆浆、即食蛋白、卤毛豆、希腊酸奶、85% 黑巧。', image: img.snack, hoursAgo: 2, views: 5200 },
  { author: 'fitness_jack', category: '榜单', content: '高蛋白食材性价比实测：鸡胸 > 鸡蛋 > 巴沙鱼 > 老豆腐 > 瘦牛腱。增肌期采购清单。', image: img.steak, hoursAgo: 6, views: 4480 },
  { author: 'nutritionist_lisa', category: '榜单', content: '膳食纤维食材榜：西兰花、豆类、燕麦、菌菇——提升饱腹感的务实选择。', image: img.veggies, hoursAgo: 12, views: 3650 },
  { author: 'chef_david', category: '榜单', content: '空气炸锅高分食材 TOP5：鸡翅、豆腐、南瓜、虾仁、口蘑的时间温度一次整理。', image: img.pumpkin, hoursAgo: 20, views: 3890 },
  { author: 'demo', category: '榜单', content: '家庭常备冷冻蔬菜红榜：西兰花、菠菜、玉米粒怎么选，营养和便利兼顾。', image: img.veggies, hoursAgo: 28, views: 2100 },
  { author: 'family_kitchen', category: '榜单', content: '厨房神器红榜：0.1g 电子秤、喷雾橄榄油瓶、玻璃密封分装盒，减脂幸福感直接拉升。', image: img.pantry, hoursAgo: 40, views: 2780 },
  { author: 'nutritionist_lisa', category: '榜单', content: '优质植物油脂星级榜：特级初榨橄榄油、亚麻籽油、牛油果油——烟点与用途对照。', image: img.oliveOil, hoursAgo: 55, views: 3010 },
  { author: 'demo', category: '榜单', content: '减脂期无糖小零食榜：冻干无花果、高蛋白黑巧、无盐南瓜籽组合。', image: img.nuts, hoursAgo: 70, views: 1920 },

  // 活动
  {
    author: 'demo', category: '活动',
    content: '#30天减脂餐早安打卡# Day 14：全麦吐司+半颗牛油果+水煮蛋。一起把早餐变成习惯。',
    image: img.avocadoToast, hoursAgo: 0.5, views: 4100,
    eventStart: isoOffset(-24 * 3), eventEnd: isoOffset(24 * 11),
  },
  {
    author: 'nutritionist_lisa', category: '活动',
    content: '#彩虹饮食法7天挑战# 第一天：红黄绿紫白五色搭配，吃出天然抗氧化。',
    image: img.veggies, hoursAgo: 4, views: 3360,
    eventStart: isoOffset(-12), eventEnd: isoOffset(24 * 6),
  },
  {
    author: 'chef_david', category: '活动',
    content: '#15分钟快手健康晚餐接力# 今晚【黑椒蒜香炒虾仁】，下一位接什么菜？',
    image: img.shrimp, hoursAgo: 9, views: 2580,
    eventStart: isoOffset(24), eventEnd: isoOffset(24 * 8),
  },
  {
    author: 'diet_helper', category: '活动',
    content: '#自制低卡办公室便当大赛# 连续 7 天晒便当赢徽章，评论区交换灵感。',
    image: img.bento, hoursAgo: 16, views: 2970,
    eventStart: isoOffset(-48), eventEnd: isoOffset(24 * 5),
  },
  {
    author: 'fitness_jack', category: '活动',
    content: '#早起空腹拉伸+低糖早餐计划# 每天 10 分钟，训练日也不水肿。',
    image: img.stretch, hoursAgo: 22, views: 2440,
    eventStart: isoOffset(48), eventEnd: isoOffset(24 * 14),
  },
  {
    author: 'family_kitchen', category: '活动',
    content: '#冰箱清库存挑战# 西兰花鸡蛋玉米焗饭打卡，晒出你的清冰箱版本！',
    image: img.mealPrep, hoursAgo: 60, views: 1880,
    eventStart: isoOffset(-24 * 14), eventEnd: isoOffset(-24 * 2),
  },
  {
    author: 'diet_helper', category: '活动',
    content: '#喝水也要打卡# 完成 2000ml 的朋友来报到，附不爱喝白水的调味灵感。',
    image: img.water, hoursAgo: 80, views: 1650,
    eventStart: isoOffset(-24 * 20), eventEnd: isoOffset(-24 * 5),
  },
  {
    author: 'family_kitchen', category: '活动',
    content: '#周末低卡烘焙大赛# 低糖无面粉烘焙作品征集中，优秀作品上社区封面。',
    image: img.bread, hoursAgo: 8, views: 2220,
    eventStart: isoOffset(-6), eventEnd: isoOffset(24 * 3),
  },

  // 问答
  { author: 'demo', category: '问答', content: '减脂期晚上饿了吃什么不破坏进度？求低热量又有饱腹感的加餐方案。', image: img.yogurt, hoursAgo: 2.5, views: 3900, question: 'open' },
  { author: 'fitness_jack', category: '问答', content: '增肌期蛋白质怎么分配到三餐？不一定每餐鸡胸，有没有更好坚持的组合？', image: img.steak, hoursAgo: 8, views: 2780, question: 'open' },
  { author: 'family_kitchen', category: '问答', content: '全麦面包成分表第一位必须是全麦粉吗？怎么识别假全麦？', image: img.bread, hoursAgo: 15, views: 2410, question: 'resolved' },
  { author: 'chef_david', category: '问答', content: '空气炸锅烤鸡胸怎样外酥里嫩、不柴不干？求温度和时间经验。', image: img.chicken, hoursAgo: 21, views: 4550, question: 'resolved' },
  { author: 'diet_helper', category: '问答', content: '减脂期如何正确算热量？生重 vs 熟重到底怎么区分？', image: img.mealPrep, hoursAgo: 33, views: 3120, question: 'open' },
  { author: 'demo', category: '问答', content: '牛油果油脂高，一天吃半个还是一整个更合适？', image: img.avocadoToast, hoursAgo: 45, views: 2680, question: 'resolved' },
  { author: 'fitness_jack', category: '问答', content: '长期低碳水要注意什么？适应期、电解质和碳水循环怎么安排？', image: img.grains, hoursAgo: 52, views: 3340, question: 'open' },
  { author: 'family_kitchen', category: '问答', content: '橄榄油、椰子油和黄油，不同烹饪温度怎么选才不容易踩坑？', image: img.oliveOil, hoursAgo: 66, views: 1990, question: 'resolved' },
];

if (resetPosts) {
  db.exec(`
    DELETE FROM community_comment_likes;
    DELETE FROM community_comments;
    DELETE FROM community_post_likes;
    DELETE FROM community_event_participants;
    DELETE FROM community_posts;
  `);
}

const existingPosts = db.prepare('SELECT COUNT(*) AS c FROM community_posts').get().c;
const insertPost = db.prepare(`
  INSERT INTO community_posts (
    user_id, username, nickname, avatar_url, category, content, image_url, image_urls,
    likes_count, comment_count, views_count, event_start_at, event_end_at, question_status, created_at
  ) VALUES (
    @user_id, @username, @nickname, @avatar_url, @category, @content, @image_url, @image_urls,
    0, 0, @views, @event_start_at, @event_end_at, @question_status, @created_at
  )
`);

const postIds = [];
const seedPosts = db.transaction(() => {
  if (existingPosts >= POSTS.length && !resetPosts) {
    console.log(`community_posts already has ${existingPosts} rows; skip post insert (use --reset-posts to rebuild)`);
    return false;
  }
  if (!resetPosts && existingPosts > 0) {
    db.exec(`
      DELETE FROM community_comment_likes;
      DELETE FROM community_comments;
      DELETE FROM community_post_likes;
      DELETE FROM community_event_participants;
      DELETE FROM community_posts;
    `);
  }
  for (const post of POSTS) {
    const author = userMeta(post.author);
    const gallery = Array.isArray(post.images) && post.images.length ? post.images : [post.image];
    const info = insertPost.run({
      user_id: author.id,
      username: author.username,
      nickname: author.nickname,
      avatar_url: author.avatar,
      category: post.category,
      content: post.content,
      image_url: gallery[0],
      image_urls: JSON.stringify(gallery),
      views: post.views || 0,
      event_start_at: post.eventStart || null,
      event_end_at: post.eventEnd || null,
      question_status: post.category === '问答' ? (post.question || 'open') : null,
      created_at: isoOffset(-(post.hoursAgo || 1)),
    });
    postIds.push({ id: Number(info.lastInsertRowid), ...post, author });
  }
  return true;
});

const inserted = seedPosts();

const allPosts = db.prepare(`
  SELECT id, user_id, username, category, question_status, content
  FROM community_posts ORDER BY id ASC
`).all();

const insertComment = db.prepare(`
  INSERT INTO community_comments (post_id, user_id, username, nickname, avatar_url, content, likes_count, created_at)
  VALUES (@post_id, @user_id, @username, @nickname, @avatar_url, @content, @likes, @created_at)
`);
const insertLike = db.prepare(`
  INSERT OR IGNORE INTO community_post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)
`);
const insertFollow = db.prepare(`
  INSERT OR IGNORE INTO community_follows (follower_id, followed_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)
`);
const insertJoin = db.prepare(`
  INSERT OR IGNORE INTO community_event_participants (post_id, user_id) VALUES (?, ?)
`);
const insertCheckin = db.prepare(`
  INSERT OR IGNORE INTO community_checkins (user_id, date_key) VALUES (?, ?)
`);
const insertDiet = db.prepare(`
  INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, created_at)
  VALUES (@user_id, @meal_type, @food_name, @amount, @calories, @protein, @carbs, @fat, @recorded_at, @recorded_time, @created_at)
`);

const commentScripts = {
  寻味: [
    { by: 'nutritionist_lisa', text: '蛋白质和复合碳水比例不错，继续保持这份搭配密度。晚餐可以再加一拳绿叶菜。' },
    { by: 'family_kitchen', text: '看着太有食欲了，今晚按这个思路清一下冰箱，豆腐版也试一下。' },
    { by: 'fitness_jack', text: '练后也能直接复刻，感谢分享火候细节。我那份三文鱼也是空气炸锅。' },
    { by: 'diet_helper', text: '收藏了！明天便当就按这个配色来。' },
  ],
  榜单: [
    { by: 'diet_helper', text: '这份榜单太实用，已经截图去采购，豆浆+卤毛豆先囤。' },
    { by: 'demo', text: '同意前三名，办公室真的好用。黑巧我换成 85%。' },
    { by: 'chef_david', text: '空气炸锅那条我补充一下：南瓜建议 180℃ 10 分钟翻面。' },
  ],
  活动: [
    { by: 'demo', text: '今日已打卡！早餐按主厨 David 的牛油果吐司做了，状态比上周轻松。' },
    { by: 'fitness_jack', text: '组队打卡动力更足，明天见。拉伸后体重水份稳多了。' },
    { by: 'chef_david', text: '我接下一道快手菜：番茄虾仁，评论区见成品。' },
    { by: 'family_kitchen', text: '周末烘焙赛报名了，准备无糖香蕉松饼参赛。' },
  ],
  问答: [
    { by: 'nutritionist_lisa', text: '【营养师回复】关键看三点：蛋白质质量、膳食纤维协同、消化吸收速率。先保证每餐有优质蛋白，再谈零食替换。饥饿感强时优先希腊酸奶/毛豆。' },
    { by: 'chef_david', text: '烹饪补充：中火慢煎或水蒸更容易锁汁，避免大火干烤。鸡胸可以先盐水泡 20 分钟。' },
    { by: 'fitness_jack', text: '增肌期的话我习惯把蛋白拆到四餐，单餐不超过 40g 更好吸收。' },
  ],
};

const threadedReplies = [
  { match: /减脂期晚上饿了/, by: 'diet_helper', text: '我办公室党常用：海苔豆腐汤 + 毛豆。刚才发过一张图，可直接抄。' },
  { match: /空气炸锅烤鸡胸/, by: 'demo', text: '按你说的盐水泡后 180℃ 12 分钟，今晚那份香草番茄鸡胸终于不柴了！' },
  { match: /假全麦/, by: 'nutritionist_lisa', text: '成分表第一位必须是「全麦粉/全谷物」，配料里糖和油越靠后越好。' },
  { match: /牛油果油脂/, by: 'chef_david', text: '减脂日半个够了，和鸡蛋/吐司搭配更稳，我早餐帖有示例。' },
];

const interact = db.transaction(() => {
  // Follow graph
  const followPairs = [
    ['demo', 'chef_david'], ['demo', 'nutritionist_lisa'], ['demo', 'fitness_jack'],
    ['chef_david', 'nutritionist_lisa'], ['chef_david', 'family_kitchen'],
    ['family_kitchen', 'demo'], ['family_kitchen', 'nutritionist_lisa'],
    ['nutritionist_lisa', 'chef_david'], ['nutritionist_lisa', 'diet_helper'],
    ['fitness_jack', 'chef_david'], ['fitness_jack', 'demo'], ['fitness_jack', 'nutritionist_lisa'],
    ['diet_helper', 'demo'], ['diet_helper', 'family_kitchen'], ['diet_helper', 'fitness_jack'],
  ];
  if (ids.local) {
    followPairs.push(['local', 'demo'], ['local', 'nutritionist_lisa'], ['local', 'chef_david']);
    for (const key of ['demo', 'chef_david', 'fitness_jack']) followPairs.push([key, 'local']);
  }
  for (const [a, b] of followPairs) {
    if (ids[a] && ids[b] && ids[a] !== ids[b]) insertFollow.run(ids[a], ids[b]);
  }

  for (const post of allPosts) {
    const likers = Object.keys(ids).filter((k) => k !== 'local' || ids.local);
    for (const key of likers) {
      if (!ids[key] || ids[key] === post.user_id) continue;
      // Deterministic-ish engagement: like most posts from other authors
      if ((post.id + ids[key]) % 3 !== 0) {
        insertLike.run(post.id, ids[key], isoOffset(-((post.id + ids[key]) % 40)));
      }
    }

    if (post.category === '活动') {
      for (const key of ['demo', 'fitness_jack', 'family_kitchen', 'diet_helper', 'local']) {
        if (ids[key] && ids[key] !== post.user_id) insertJoin.run(post.id, ids[key]);
      }
    }

    const scripts = commentScripts[post.category] || commentScripts.寻味;
    const createdCommentIds = [];
    scripts.forEach((script, index) => {
      const author = userMeta(script.by);
      if (!author?.id || author.id === post.user_id) return;
      const info = insertComment.run({
        post_id: post.id,
        user_id: author.id,
        username: author.username,
        nickname: author.nickname,
        avatar_url: author.avatar,
        content: script.text,
        likes: 8 + ((post.id + index) % 20),
        created_at: isoOffset(-(index + 1) * 0.7 - (post.id % 5)),
      });
      createdCommentIds.push(Number(info.lastInsertRowid));
    });

    for (const reply of threadedReplies) {
      if (!reply.match.test(post.content || '')) continue;
      const author = userMeta(reply.by);
      if (!author?.id || author.id === post.user_id) continue;
      insertComment.run({
        post_id: post.id,
        user_id: author.id,
        username: author.username,
        nickname: author.nickname,
        avatar_url: author.avatar,
        content: reply.text,
        likes: 15 + (post.id % 12),
        created_at: isoOffset(-(0.3 + (post.id % 4))),
      });
    }

    if (post.category === '问答' && post.question_status === 'resolved' && createdCommentIds[0]) {
      db.prepare(`UPDATE community_posts SET accepted_comment_id=?, question_status='resolved' WHERE id=?`)
        .run(createdCommentIds[0], post.id);
    }
  }

  // Sync counters from real rows
  db.exec(`
    UPDATE community_posts SET
      likes_count = (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = community_posts.id),
      comment_count = (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = community_posts.id)
  `);

  // Check-ins last 7 days for demo + local
  for (const key of ['demo', 'fitness_jack', 'local', 'diet_helper']) {
    if (!ids[key]) continue;
    for (let i = 0; i < 7; i += 1) insertCheckin.run(ids[key], dayKey(i));
  }

  // Diet records for demo / jack / local (skip if already many)
  const dietTargets = [
    { key: 'demo', meals: [
      ['早餐', '全麦吐司配牛油果', '1份', 320, 14, 28, 16],
      ['午餐', '羽衣甘蓝鸡胸沙拉', '1份', 420, 38, 22, 18],
      ['晚餐', '番茄牛肉蔬菜汤', '1碗', 280, 24, 20, 9],
      ['加餐', '无糖希腊酸奶', '150g', 90, 15, 5, 0],
    ]},
    { key: 'fitness_jack', meals: [
      ['早餐', '鸡蛋燕麦碗', '1碗', 450, 32, 48, 12],
      ['午餐', '牛肉彩椒糙米饭', '1份', 620, 42, 55, 18],
      ['晚餐', '烤三文鱼口蘑', '1份', 510, 40, 12, 28],
      ['加餐', '乳糖游离蛋白粉', '1勺', 120, 24, 2, 1],
    ]},
    { key: 'chef_david', meals: [
      ['早餐', '全麦牛油果吐司', '1份', 360, 16, 30, 18],
      ['午餐', '番茄虾仁意面', '1份', 480, 28, 55, 14],
      ['晚餐', '香煎鸡胸南瓜', '1份', 430, 36, 26, 12],
    ]},
  ];
  if (ids.local) {
    dietTargets.push({
      key: 'local',
      meals: [
        ['早餐', '隔夜燕麦杯', '1杯', 310, 12, 42, 8],
        ['午餐', '低卡便当', '1份', 520, 34, 48, 16],
        ['晚餐', '清炒时蔬豆腐', '1份', 290, 18, 18, 12],
      ],
    });
  }

  for (const target of dietTargets) {
    if (!ids[target.key]) continue;
    if (resetPosts) {
      db.prepare('DELETE FROM diet_records WHERE user_id=?').run(ids[target.key]);
      db.prepare('DELETE FROM health_logs WHERE user_id=?').run(ids[target.key]);
    }
    const count = db.prepare('SELECT COUNT(*) AS c FROM diet_records WHERE user_id=?').get(ids[target.key]).c;
    if (count >= 12) continue;
    for (let day = 0; day < 7; day += 1) {
      target.meals.forEach((meal, idx) => {
        const [meal_type, food_name, amount, calories, protein, carbs, fat] = meal;
        insertDiet.run({
          user_id: ids[target.key],
          meal_type,
          food_name,
          amount,
          calories,
          protein,
          carbs,
          fat,
          recorded_at: dayKey(day),
          recorded_time: `${7 + idx * 4}:30`,
          created_at: isoOffset(-(day * 24 + idx)),
        });
      });
      db.prepare(`
        INSERT INTO health_logs (user_id, weight, steps, sleep_hours, recorded_at, recorded_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        ids[target.key],
        target.key === 'fitness_jack' ? 78.2 - day * 0.05 : 58.6 - day * 0.04,
        6500 + day * 420 + (ids[target.key] % 800),
        6.5 + (day % 3) * 0.4,
        dayKey(day),
        dayKey(day),
        isoOffset(-(day * 24)),
      );
    }
  }

  const upsertProfile = db.prepare(`
    INSERT INTO user_health_profiles (user_id, profile_json) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json
  `);
  const profiles = {
    demo: {
      version: 1,
      allergies: [{ name: '坚果', severity: 'severe' }],
      dietary_restrictions: ['低钠'],
      medical_conditions: [],
      medications: '',
      currentMeasurements: {
        height_cm: { value: 165 },
        weight: { value: 58.4 },
        body_fat: { value: 26.5 },
      },
      goals: { daily_calories_target: 1600, focus: 'fat_loss' },
    },
    fitness_jack: {
      version: 1,
      allergies: [{ name: '乳糖', severity: 'moderate' }],
      dietary_restrictions: ['高蛋白'],
      medical_conditions: [],
      medications: '',
      currentMeasurements: {
        height_cm: { value: 178 },
        weight: { value: 78.0 },
        body_fat: { value: 14.2 },
      },
      goals: { daily_calories_target: 2800, focus: 'muscle_gain' },
    },
    chef_david: {
      version: 1,
      allergies: [],
      dietary_restrictions: ['控糖', '低盐'],
      medical_conditions: [],
      medications: '',
      currentMeasurements: {
        height_cm: { value: 175 },
        weight: { value: 72.5 },
        body_fat: { value: 18.0 },
      },
      goals: { daily_calories_target: 2200, focus: 'maintain' },
    },
    nutritionist_lisa: {
      version: 1,
      allergies: [],
      dietary_restrictions: ['素食'],
      medical_conditions: [],
      medications: '',
      currentMeasurements: {
        height_cm: { value: 168 },
        weight: { value: 55.0 },
      },
      goals: { daily_calories_target: 1800, focus: 'maintain' },
    },
  };
  for (const [key, profile] of Object.entries(profiles)) {
    if (ids[key]) upsertProfile.run(ids[key], JSON.stringify(profile));
  }
});

interact();

const summary = {
  db: dbPath,
  password: 'DEMO_USER_PASSWORD (shared by 6 demo accounts)',
  users: USERS.map((u) => ({ email: u.email, nickname: u.nickname, id: ids[u.key] })),
  local_user_id: ids.local || null,
  posts: db.prepare('SELECT category, COUNT(*) AS c FROM community_posts GROUP BY category').all(),
  comments: db.prepare('SELECT COUNT(*) AS c FROM community_comments').get().c,
  likes: db.prepare('SELECT COUNT(*) AS c FROM community_post_likes').get().c,
  follows: db.prepare('SELECT COUNT(*) AS c FROM community_follows').get().c,
  event_joins: db.prepare('SELECT COUNT(*) AS c FROM community_event_participants').get().c,
  diet_records: db.prepare('SELECT COUNT(*) AS c FROM diet_records').get().c,
  rebuilt_posts: Boolean(inserted),
};

console.log(JSON.stringify(summary, null, 2));
db.close();
