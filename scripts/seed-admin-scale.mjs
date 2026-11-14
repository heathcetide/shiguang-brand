#!/usr/bin/env node
/**
 * Scale local demo data for admin pages:
 * - ≥5000 users
 * - rich community posts / Q&A / events / comments
 * - Chinese kitchenware catalog with images
 * - health profiles + diet records for analytics trends
 * - recipe cover images where missing
 *
 * Usage:
 *   DEMO_USER_PASSWORD='DemoPassword1234' node scripts/seed-admin-scale.mjs
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH
  || resolve(__dirname, '../data/dietdigidose.db');

const password = process.env.DEMO_USER_PASSWORD || 'DemoPassword1234';
const targetUsers = Number(process.env.SEED_USER_COUNT || 5000);
const targetPosts = Number(process.env.SEED_POST_COUNT || 2500);
const targetChineseKw = Number(process.env.SEED_CN_KITCHENWARE || 800);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function ensureColumn(table, column, ddl) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

for (const [table, column, ddl] of [
  ['community_posts', 'username', 'TEXT'],
  ['community_posts', 'nickname', 'TEXT'],
  ['community_posts', 'avatar_url', 'TEXT'],
  ['community_posts', 'image_url', 'TEXT'],
  ['community_posts', 'category', 'TEXT'],
  ['community_posts', 'likes_count', 'INTEGER DEFAULT 0'],
  ['community_posts', 'comment_count', 'INTEGER DEFAULT 0'],
  ['community_posts', 'views_count', 'INTEGER DEFAULT 0'],
  ['community_posts', 'question_status', 'TEXT'],
  ['community_posts', 'event_start_at', 'TEXT'],
  ['community_posts', 'event_end_at', 'TEXT'],
  ['community_comments', 'username', 'TEXT'],
  ['community_comments', 'nickname', 'TEXT'],
  ['community_comments', 'avatar_url', 'TEXT'],
  ['recipes', 'cover_image_url', 'TEXT'],
  ['recipes', 'image_url', 'TEXT'],
  ['kitchenware_catalog', 'image_url', 'TEXT'],
  ['kitchenware_catalog', 'description', 'TEXT'],
  ['kitchenware_catalog', 'aliases', "TEXT DEFAULT '[]'"],
  ['kitchenware_catalog', 'source', 'TEXT'],
]) {
  try { ensureColumn(table, column, ddl); } catch { /* table may be missing */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_health_profiles (
    user_id INTEGER PRIMARY KEY,
    profile_json TEXT
  );
  CREATE TABLE IF NOT EXISTS community_post_likes (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id)
  );
`);

const surnames = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚'.split('');
const given = '伟芳娜敏静丽强磊军洋勇艳杰涛超秀英华慧巧美娜静淑惠珠翠雅芝玉萍红娥玲芬芳燕彩春菊兰凤洁梅琳素云莲真环雪荣爱妹霞香月莺媛艳瑞凡佳嘉琼勤珍贞莉桂娣叶璧璐岚露曼凡嘉'.split('');
const cities = ['上海', '北京', '杭州', '成都', '深圳', '广州', '南京', '武汉', '西安', '苏州', '重庆', '厦门'];
const mealNames = ['燕麦牛奶', '番茄炒蛋', '鸡胸沙拉', '清蒸鲈鱼', '杂粮饭', '西兰花牛肉', '豆腐汤', '全麦三明治', '虾仁时蔬', '紫薯粥', '凉拌黄瓜', '蒜香鸡腿'];
const postTemplates = {
  寻味: [
    '今天做了{dish}，减油少盐也很好吃，分享一下做法心得。',
    '周末尝试了新菜{dish}，家人都说比外卖强。',
    '冰箱清库存做成了{dish}，没浪费食材超级开心。',
    '打卡第{n}天健康餐：{dish}，热量控制在目标内。',
  ],
  问答: [
    '有没有适合上班族的快手低脂午餐推荐？最好 20 分钟内能完成。',
    '备孕阶段怎么搭配蛋白质和叶酸食物比较稳妥？',
    '空气炸锅做鸡胸总是干，有没有保湿的小技巧？',
    '控糖期间主食可以换成哪些杂粮？求真实体验。',
    '宿舍只有电磁炉，能做什么像样的一锅出菜？',
  ],
  活动: [
    '本周末线下轻食市集，欢迎带自己做的{dish}来交换。',
    '线上 7 天减盐挑战报名中，每天打卡饮食记录即可。',
    '社区厨具清点互助局，交换闲置锅具刀具。',
    '月底营养师答疑夜，提交你的饮食困惑。',
  ],
};
const dishes = ['番茄牛腩', '蒜蓉西兰花', '日式煎鲑鱼', '香菇青菜面', '麻婆豆腐轻油版', '柠檬鸡胸', '南瓜小米粥', '虾仁滑蛋'];
const chineseKitchenware = [
  ['炒锅', '烹饪锅具', '铁锅、不粘炒锅'],
  ['汤锅', '烹饪锅具', '炖锅、煮锅'],
  ['蒸锅', '烹饪锅具', '多层蒸笼'],
  ['砂锅', '烹饪锅具', '煲汤砂锅'],
  ['高压锅', '烹饪锅具', '压力锅'],
  ['奶锅', '烹饪锅具', '小奶锅'],
  ['平底锅', '烹饪锅具', '煎锅'],
  ['铸铁锅', '烹饪锅具', '荷兰锅'],
  ['空气炸锅', '小家电', '空气炸'],
  ['电饭煲', '小家电', '电饭锅'],
  ['破壁机', '小家电', '料理机'],
  ['豆浆机', '小家电', '打浆机'],
  ['电烤箱', '小家电', '家用烤箱'],
  ['微波炉', '小家电', '加热炉'],
  ['电磁炉', '小家电', '电磁灶'],
  ['养生壶', '小家电', '煮茶壶'],
  ['电蒸箱', '小家电', '蒸汽炉'],
  ['榨汁机', '小家电', '原汁机'],
  ['厨师机', '小家电', '和面机'],
  ['咖啡机', '小家电', '意式咖啡机'],
  ['菜刀', '刀具餐具', '切片刀'],
  ['砧板', '刀具餐具', '菜板'],
  ['刨丝器', '刀具餐具', '擦丝器'],
  ['削皮刀', '刀具餐具', '刮皮刀'],
  ['厨房剪刀', '刀具餐具', '食物剪'],
  ['汤勺', '刀具餐具', '长柄勺'],
  ['筷子', '刀具餐具', '竹筷'],
  ['餐盘', '刀具餐具', '浅盘'],
  ['碗', '刀具餐具', '饭碗'],
  ['量杯', '烘焙工具', '计量杯'],
  ['电子秤', '烘焙工具', '厨房秤'],
  ['搅拌盆', '烘焙工具', '打蛋盆'],
  ['刮刀', '烘焙工具', '硅胶刮刀'],
  ['裱花袋', '烘焙工具', '挤花袋'],
  ['烤盘', '烘焙工具', '烤箱烤盘'],
  ['模具', '烘焙工具', '蛋糕模'],
  ['筛网', '烘焙工具', '面粉筛'],
  ['保鲜膜切割器', '其他', '保鲜膜盒'],
  ['沥水篮', '其他', '洗菜篮'],
  ['储物罐', '其他', '密封罐'],
  ['保温饭盒', '其他', '便当盒'],
  ['油壶', '其他', '玻璃油瓶'],
  ['调料盒', '其他', '调味罐'],
  ['厨房纸巾架', '其他', '纸巾架'],
  ['防溅锅盖', '其他', '锅盖'],
];

function pick(arr, i) {
  return arr[i % arr.length];
}

function daysAgo(n, hour = 12) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, (n * 7) % 60, 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

const realRecipeImages = db.prepare(`
  SELECT DISTINCT image_url FROM recipes
  WHERE image_url LIKE '%/catalog/recipes/real-%'
  ORDER BY id LIMIT 240
`).all().map((row) => row.image_url);

function foodImage(seed) {
  const urls = realRecipeImages.length > 0 ? realRecipeImages : [
    'https://cdn.lingecho.com/dietdigidose/catalog/recipes/real-1ceff069829cb860f464.jpg',
  ];
  return urls[Math.abs(Number(seed) || 0) % urls.length];
}

function kwImage(seed) {
  return foodImage((Number(seed) || 0) + 7);
}

console.log(`DB: ${dbPath}`);
const passwordHash = bcrypt.hashSync(password, 10);
const existingUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
const needUsers = Math.max(0, targetUsers - existingUsers);
console.log(`Users now ${existingUsers}, creating ${needUsers}…`);

const insertUser = db.prepare(`
  INSERT INTO users (username, email, phone, password_hash, nickname, avatar_url, role, is_verified_expert, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?)
`);

if (needUsers > 0) {
  const tx = db.transaction((count) => {
    for (let i = 0; i < count; i++) {
      const n = existingUsers + i + 1;
      const username = `shiwei_${String(n).padStart(4, '0')}`;
      const nick = `${pick(surnames, n)}${pick(given, n * 3)}${pick(given, n * 7)}`;
      const created = daysAgo(Math.floor(Math.random() * 30), 8 + (n % 10));
      insertUser.run(
        username,
        `${username}@dietdigidose.test`,
        `138${String(10000000 + (n % 89999999)).slice(0, 8)}`,
        passwordHash,
        nick,
        `preset-avatar:${n % 7}`,
        n % 37 === 0 ? 1 : 0,
        created,
      );
    }
  });
  tx(needUsers);
}

const userIds = db.prepare('SELECT id, username, nickname, avatar_url FROM users ORDER BY id').all();
console.log(`Users total: ${userIds.length}`);

const upsertHealth = db.prepare(`
  INSERT INTO user_health_profiles (user_id, profile_json) VALUES (?, ?)
  ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json
`);
const healthTx = db.transaction(() => {
  for (let i = 0; i < Math.min(userIds.length, 2200); i++) {
    const user = userIds[i];
    if (i % 3 === 0) continue; // leave some empty for “尚未建档”
    const profile = {
      gender: i % 2 === 0 ? '女' : '男',
      age: 18 + (i % 45),
      height: 155 + (i % 30),
      weight: 48 + (i % 40),
      target_weight: 50 + (i % 25),
      dietary_preference: pick(['均衡', '高蛋白', '素食友好', '低升糖'], i),
      allergies: i % 5 === 0 ? [{ name: '花生', type: 'allergy', severity: 'moderate' }] : [],
      medications: i % 11 === 0 ? '维生素 D 补充' : '',
      medical_conditions: i % 13 === 0 ? ['乳糖不耐受'] : [],
      medical_notes: '',
      dietary_restrictions: i % 7 === 0 ? ['少油少盐'] : [],
      disliked_foods: i % 9 === 0 ? '香菜' : '',
      kitchen_constraints: {
        meal_time_minutes: 20 + (i % 40),
        budget_per_meal: 15 + (i % 35),
        cooking_level: pick(['beginner', 'intermediate', 'advanced'], i),
        servings: 1 + (i % 3),
        eating_out_frequency: pick(['rarely', 'weekly', 'often'], i),
      },
      nutrition_targets: {
        calories_kcal: 1600 + (i % 800),
        protein_g: 60 + (i % 60),
        salt_g: 5,
        sugar_g: 25,
        water_ml: 1800 + (i % 600),
        professional_advice: `建议结合${pick(cities, i)}作息安排三餐。`,
      },
      tracking_enabled: true,
      updated_at: daysAgo(i % 20),
    };
    upsertHealth.run(user.id, JSON.stringify(profile));
  }
});
healthTx();
console.log('Health profiles upserted');

const insertDiet = db.prepare(`
  INSERT INTO diet_records (user_id, meal_type, food_name, calories, protein, carbs, fat, recorded_at, created_at, amount)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const dietCount = db.prepare('SELECT COUNT(*) AS c FROM diet_records').get().c;
if (dietCount < 8000) {
  const need = 8000 - dietCount;
  const tx = db.transaction(() => {
    for (let i = 0; i < need; i++) {
      const user = pick(userIds, i * 11);
      const day = i % 30;
      const meal = pick(['早餐', '午餐', '晚餐', '加餐'], i);
      const food = pick(mealNames, i);
      const created = daysAgo(day, 7 + (i % 12));
      insertDiet.run(
        user.id,
        meal,
        food,
        180 + (i % 420),
        8 + (i % 35),
        20 + (i % 55),
        5 + (i % 25),
        created,
        created,
        `${100 + (i % 250)}g`,
      );
    }
  });
  tx();
  console.log(`Diet records added (now ${db.prepare('SELECT COUNT(*) AS c FROM diet_records').get().c})`);
}

const postCount = db.prepare(`SELECT COUNT(*) AS c FROM community_posts WHERE deleted_at IS NULL OR deleted_at IS NULL`).get().c;
const insertPost = db.prepare(`
  INSERT INTO community_posts
    (user_id, username, nickname, avatar_url, category, content, image_url, likes_count, views_count, comment_count, question_status, event_start_at, event_end_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertComment = db.prepare(`
  INSERT INTO community_comments (post_id, user_id, username, nickname, avatar_url, content, likes_count, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

if (postCount < targetPosts) {
  const need = targetPosts - postCount;
  const tx = db.transaction(() => {
    for (let i = 0; i < need; i++) {
      const user = pick(userIds, i * 3 + 5);
      const category = pick(['寻味', '问答', '活动'], i);
      const template = pick(postTemplates[category], i);
      const content = template
        .replace('{dish}', pick(dishes, i))
        .replace('{n}', String(1 + (i % 30)));
      const created = daysAgo(i % 30, 9 + (i % 10));
      const likes = 1 + (i % 80);
      const views = likes * (2 + (i % 5));
      const commentN = 1 + (i % 6);
      const questionStatus = category === '问答' ? (i % 3 === 0 ? 'resolved' : 'open') : null;
      const eventStart = category === '活动' ? daysAgo(-(i % 5), 10) : null;
      const eventEnd = category === '活动' ? daysAgo(-(i % 5) - 1, 18) : null;
      const image = category === '寻味' || i % 4 === 0 ? foodImage(1000 + i) : null;
      const info = insertPost.run(
        user.id,
        user.username,
        user.nickname || user.username,
        user.avatar_url,
        category,
        content,
        image,
        likes,
        views,
        commentN,
        questionStatus,
        eventStart,
        eventEnd,
        created,
      );
      const postId = Number(info.lastInsertRowid);
      for (let c = 0; c < commentN; c++) {
        const commenter = pick(userIds, i * 7 + c * 13);
        insertComment.run(
          postId,
          commenter.id,
          commenter.username,
          commenter.nickname || commenter.username,
          commenter.avatar_url,
          pick([
            '学到了，今晚就试。',
            '热量控制得不错。',
            '我也常这么做，推荐少油版。',
            '可以再加点香料提味。',
            '求详细配料表！',
            '专业解答，感谢。',
          ], i + c),
          c,
          daysAgo(i % 30, 12 + c),
        );
      }
    }
  });
  tx();
  console.log(`Community posts now ${db.prepare('SELECT COUNT(*) AS c FROM community_posts').get().c}`);
}

const cnExisting = db.prepare(`SELECT COUNT(*) AS c FROM kitchenware_catalog WHERE name GLOB '*[一-龥]*'`).get().c;
const insertKw = db.prepare(`
  INSERT INTO kitchenware_catalog (name, category, description, image_url, aliases, source, quality_status)
  VALUES (?, ?, ?, ?, ?, 'official_cn', 'trusted')
`);
if (cnExisting < targetChineseKw) {
  const need = targetChineseKw - cnExisting;
  const tx = db.transaction(() => {
    for (let i = 0; i < need; i++) {
      const [base, category, alias] = pick(chineseKitchenware, i);
      const variant = ['家用', '不锈钢', '铸铁', '陶瓷', '便携', '多功能', '迷你', '大容量'][i % 8];
      const name = `${variant}${base}${i > chineseKitchenware.length ? `·${i}` : ''}`;
      insertKw.run(
        name,
        category,
        `${name}，适合家庭日常烹饪与备餐。`,
        kwImage(2000 + i),
        JSON.stringify([alias, base]),
      );
    }
  });
  tx();
  console.log(`Chinese kitchenware now ${db.prepare(`SELECT COUNT(*) AS c FROM kitchenware_catalog WHERE name GLOB '*[一-龥]*'`).get().c}`);
}

// Prefer Chinese names when listing: bump Chinese rows to higher ids already via inserts.
// Fill missing images on Chinese rows.
db.prepare(`
  UPDATE kitchenware_catalog
  SET image_url = 'https://cdn.lingecho.com/dietdigidose/catalog/recipes/1-332bf9a8368f7d52.jpg'
  WHERE (image_url IS NULL OR image_url='') AND name GLOB '*[一-龥]*'
`).run();

const missingRecipeImages = db.prepare(`
  SELECT id FROM recipes
  WHERE COALESCE(NULLIF(image_url,''), NULLIF(cover_image_url,''), '')=''
  LIMIT 5000
`).all();
const updateRecipeImage = db.prepare(`UPDATE recipes SET cover_image_url=?, image_url=COALESCE(NULLIF(image_url,''), ?) WHERE id=?`);
const recipeTx = db.transaction((rows) => {
  for (const row of rows) {
    const url = foodImage(row.id);
    updateRecipeImage.run(url, url, row.id);
  }
});
recipeTx(missingRecipeImages);
console.log(`Filled ${missingRecipeImages.length} recipe images`);

// Soft-mark obvious English OFF clutter as needs_review so Chinese catalog stands out in trusted views.
db.prepare(`
  UPDATE kitchenware_catalog
  SET quality_status='needs_review'
  WHERE name NOT GLOB '*[一-龥]*' AND COALESCE(quality_status,'')!='trusted'
`).run();

console.log(JSON.stringify({
  users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
  posts: db.prepare('SELECT COUNT(*) AS c FROM community_posts').get().c,
  comments: db.prepare('SELECT COUNT(*) AS c FROM community_comments').get().c,
  dietRecords: db.prepare('SELECT COUNT(*) AS c FROM diet_records').get().c,
  healthProfiles: db.prepare('SELECT COUNT(*) AS c FROM user_health_profiles').get().c,
  kitchenware: db.prepare('SELECT COUNT(*) AS c FROM kitchenware_catalog').get().c,
  chineseKitchenware: db.prepare(`SELECT COUNT(*) AS c FROM kitchenware_catalog WHERE name GLOB '*[一-龥]*'`).get().c,
  recipesWithImage: db.prepare(`SELECT COUNT(*) AS c FROM recipes WHERE COALESCE(NULLIF(image_url,''), NULLIF(cover_image_url,''), '')!=''`).get().c,
}, null, 2));

db.close();
