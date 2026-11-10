import { isPasswordWithinByteLimit } from "@dietdigidose/contracts";
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { runMigrations } from './migrations.js';
import { dateKeyAfterDays } from '../utils/date.js';

const configuredDatabasePath = process.env.DATABASE_PATH?.trim();
const dbDir = configuredDatabasePath
  ? path.dirname(path.resolve(configuredDatabasePath))
  : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const dbPath = configuredDatabasePath
  ? path.resolve(configuredDatabasePath)
  : path.join(dbDir, 'dietdigidose.db');
export const db = new Database(dbPath);

// Enable WAL for performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function tableExists(name: string) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function tableHasColumn(table: string, column: string) {
  if (!tableExists(table)) return false;
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((row) => row.name === column);
}

function ensureColumn(table: string, column: string, definition: string) {
  if (tableHasColumn(table, column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
    // 保持幂等。线上旧库偶发 schema 交叉重建时，该错误会是 harmless 的。
  }
}

function ensureSchemaCompatibility() {
  // 与 recommendations 与 inventory 路由强绑定的核心能力表。
  if (!tableExists('recipe_recommendation_requests')) {
    db.exec(`
      CREATE TABLE recipe_recommendation_requests (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        surface TEXT NOT NULL,
        scoring_version TEXT NOT NULL,
        candidate_version TEXT NOT NULL,
        input_hash TEXT,
        input_snapshot_json TEXT,
        results_json TEXT NOT NULL,
        data_updated_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_recipe_recommendation_requests_user_created ON recipe_recommendation_requests(user_id, created_at DESC)`);
  }
  if (!tableExists('recipe_recommendation_events')) {
    db.exec(`
      CREATE TABLE recipe_recommendation_events (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        request_id TEXT,
        recipe_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        scoring_version TEXT NOT NULL,
        surface TEXT NOT NULL,
        metadata_json TEXT,
        idempotency_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (request_id) REFERENCES recipe_recommendation_requests(id) ON DELETE SET NULL,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_recipe_recommendation_events_user_recipe ON recipe_recommendation_events(user_id, recipe_id, created_at DESC)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_recommendation_events_idempotency ON recipe_recommendation_events(idempotency_key) WHERE idempotency_key IS NOT NULL`);
  }

  // 与食谱-厨具映射强绑定的兼容字段。
  if (!tableExists('recipe_kitchenware_requirements')) {
    db.exec(`
      CREATE TABLE recipe_kitchenware_requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        catalog_id INTEGER,
        capability_code TEXT,
        role TEXT NOT NULL DEFAULT 'required',
        source TEXT,
        confidence REAL DEFAULT 0.9,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        FOREIGN KEY (catalog_id) REFERENCES kitchenware_catalog(id) ON DELETE SET NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_recipe_kitchenware_requirements_recipe_role ON recipe_kitchenware_requirements(recipe_id, role)`);
  }

  if (!tableExists('kitchenware_mapping_reviews')) {
    db.exec(`
      CREATE TABLE kitchenware_mapping_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        confidence REAL DEFAULT 0,
        suggested_catalog_id INTEGER,
        reviewed_at DATETIME,
        reviewed_by INTEGER,
        reviewed_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(normalized_name, source_type, source_id)
      )
    `);
  }

  // 旧库存表缺失新字段时补齐。
  ensureColumn('inventory_items', 'quantity_value', 'REAL');
  ensureColumn('inventory_items', 'quantity_unit', 'TEXT');
  ensureColumn('inventory_items', 'package_size_value', 'REAL');
  ensureColumn('inventory_items', 'package_size_unit', 'TEXT');
  ensureColumn('inventory_items', 'batch_code', 'TEXT');
  ensureColumn('inventory_items', 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('inventory_items', 'updated_at', 'DATETIME');
  ensureColumn('inventory_items', 'deleted_at', 'DATETIME');

  // 旧食谱表缺失新字段时补齐。
  ensureColumn('recipes', 'quality_status', "TEXT NOT NULL DEFAULT 'trusted'");
  ensureColumn('recipes', 'quality_issues_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('recipes', 'quality_reviewed_by', 'INTEGER');
  ensureColumn('recipes', 'quality_reviewed_at', 'DATETIME');
  ensureColumn('recipes', 'quality_review_reason', 'TEXT');
  ensureColumn('recipes', 'nutrition_basis', "TEXT NOT NULL DEFAULT 'source'");

  db.prepare("UPDATE inventory_items SET version = COALESCE(version, 1)").run();
  db.prepare("UPDATE inventory_items SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)").run();
  db.prepare("UPDATE recipes SET quality_status = COALESCE(quality_status, 'trusted')").run();
  db.prepare("UPDATE recipes SET nutrition_basis = COALESCE(nutrition_basis, 'source')").run();
  db.prepare("UPDATE recipes SET quality_issues_json = COALESCE(quality_issues_json, '[]')").run();
}

export function initDatabase() {
  console.log('Initializing SQLite Database at:', dbPath);

  // 1. Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      avatar_url TEXT,
      bio TEXT,
      role TEXT DEFAULT 'user',
      must_change_password INTEGER DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 1,
      daily_calories_target INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Inventory Items
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      food_name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity TEXT NOT NULL,
      expiration_date TEXT NOT NULL,
      storage_location TEXT DEFAULT '冷藏',
      image_url TEXT,
      is_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 2.1 User Kitchenware
  db.exec(`
    CREATE TABLE IF NOT EXISTS kitchenware_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      original_name TEXT,
      category TEXT NOT NULL,
      status TEXT DEFAULT '良好',
      note TEXT,
      image_url TEXT,
      purchase_date TEXT,
      last_maintained_at DATETIME,
      usage_count INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by INTEGER,
      ip_location TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kitchenware_user_created_at
    ON kitchenware_items(user_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_kitchenware_deleted_at
    ON kitchenware_items(deleted_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS kitchenware_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      aliases TEXT DEFAULT '[]',
      cooking_methods TEXT DEFAULT '[]',
      care_note TEXT,
      source TEXT DEFAULT 'system',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  {
    const insertCatalog = db.prepare("INSERT OR IGNORE INTO kitchenware_catalog (name, category, aliases, cooking_methods, care_note) VALUES (?, ?, ?, ?, ?)");
    const catalogItems = [
      ["空气炸锅", "小家电", ["空气炸锅烤箱"], ["烘烤", "复热"], "每次使用后清洁炸篮并保持通风"],
      ["电饭煲", "小家电", ["电饭锅"], ["煮饭", "煲粥", "蒸煮"], "内胆避免金属硬物刮擦"],
      ["微波炉", "小家电", ["微波炉烤箱"], ["加热", "解冻"], "定期擦拭腔体，避免空转"],
      ["烤箱", "小家电", ["电烤箱"], ["烘烤", "烘焙"], "冷却后清洁烤盘与内壁"],
      ["破壁机", "小家电", ["料理机", "搅拌机"], ["搅拌", "打浆"], "刀头区域避免长时间浸泡"],
      ["豆浆机", "小家电", ["养生壶"], ["煮浆", "煮饮"], "使用后及时清洗杯体和刀头"],
      ["平底锅", "烹饪锅具", ["煎锅", "不粘锅"], ["煎", "炒"], "不粘涂层避免使用金属铲"],
      ["炒锅", "烹饪锅具", ["铁锅", "中式炒锅"], ["炒", "煎", "爆炒"], "铁锅清洗后擦干并薄涂食用油"],
      ["汤锅", "烹饪锅具", ["炖锅"], ["煮", "炖"], "避免干烧，定期检查锅底"],
      ["蒸锅", "烹饪锅具", ["蒸笼"], ["蒸"], "使用后擦干蒸屉和锅底"],
      ["砂锅", "烹饪锅具", ["陶锅"], ["炖", "煲"], "避免骤冷骤热，清洗后自然晾干"],
      ["压力锅", "烹饪锅具", ["高压锅"], ["压煮", "炖"], "定期检查密封圈和排气阀"],
      ["多功能锅", "小家电", ["电火锅", "料理锅"], ["煎", "炒", "煮", "蒸"], "使用后及时清洁内胆，避免长时间浸泡底座"],
      ["慢炖锅", "小家电", ["电炖锅"], ["慢炖", "煲汤"], "清洁前先断电，陶瓷内胆避免骤冷骤热"],
      ["蒸烤一体机", "小家电", ["蒸烤箱"], ["蒸", "烘烤", "复热"], "每次蒸制后排净积水并擦干腔体"],
      ["电磁炉", "小家电", ["电陶炉"], ["煎", "炒", "煮"], "保持面板干燥，使用兼容的平底锅具"],
      ["洗碗机", "小家电", ["自动洗碗机"], ["清洗", "烘干"], "定期清理滤网并补充专用盐和漂洗剂"],
      ["榨汁机", "小家电", ["原汁机"], ["榨汁"], "使用后立即清洗滤网，避免果渣干结"],
      ["手持搅拌器", "小家电", ["手持料理棒"], ["搅拌", "打发", "打泥"], "机身避免进水，刀头用后及时清洁"],
      ["真空封口机", "小家电", ["抽真空机"], ["密封", "保鲜"], "清理封口条残渣，避免液体进入抽气口"],
      ["奶锅", "烹饪锅具", ["小汤锅", "雪平锅"], ["煮", "热奶", "煮面"], "避免干烧，使用后擦干锅底"],
      ["焖烧锅", "烹饪锅具", ["保温焖烧锅"], ["焖", "保温"], "内胆和密封圈清洗后彻底晾干"],
      ["厨师刀", "刀具餐具", ["主厨刀"], ["切配"], "手洗擦干，定期磨刀"],
      ["菜刀", "刀具餐具", ["中式菜刀"], ["切配"], "使用木质或塑料砧板保护刀刃"],
      ["砧板", "刀具餐具", ["切菜板"], ["切配"], "生熟分开，使用后清洁晾干"],
      ["电子秤", "刀具餐具", ["厨房秤"], ["称量"], "避免进水，定期更换电池"],
      ["厨房温度计", "刀具餐具", ["食物温度计", "探针温度计"], ["测温"], "探针用后清洁消毒，避免浸泡显示屏"],
      ["厨房计时器", "刀具餐具", ["烹饪计时器"], ["计时"], "避免进水，长期不用时取出电池"],
      ["压蒜器", "刀具餐具", ["蒜蓉器"], ["切配"], "及时清理压孔残渣，避免食物残留干结"],
      ["磨刀器", "刀具餐具", ["磨刀石"], ["磨刀"], "按说明使用并远离儿童，使用后擦净金属碎屑"],
      ["隔热手套", "刀具餐具", ["烤箱手套"], ["防烫"], "保持干燥，磨损或沾油严重时及时更换"],
      ["量杯量勺", "刀具餐具", ["量杯", "量勺"], ["称量"], "用后清洗晾干并集中收纳"],
      ["烤盘", "烘焙工具", ["烘焙盘"], ["烘焙"], "避免尖锐器具刮伤涂层"],
      ["蛋糕模具", "烘焙工具", ["烤模"], ["烘焙"], "彻底晾干后收纳，避免叠压变形"],
      ["打蛋器", "烘焙工具", ["手动打蛋器", "电动打蛋器"], ["打发", "搅拌"], "电动款避免机身进水"],
      ["硅胶刮刀", "烘焙工具", ["刮刀"], ["烘焙", "搅拌"], "避免贴近明火，清洗后晾干"],
      ["饭碗", "刀具餐具", ["碗", "米饭碗"], ["盛装", "用餐"], "避免骤冷骤热，破损后及时更换"],
      ["汤碗", "刀具餐具", ["面碗", "大碗"], ["盛装", "用餐"], "避免骤冷骤热，破损后及时更换"],
      ["餐盘", "刀具餐具", ["盘子", "菜盘"], ["盛装", "用餐"], "清洗后竖放晾干，避免重压"],
      ["马克杯", "刀具餐具", ["水杯", "咖啡杯"], ["饮用"], "避免长时间残留茶渍或咖啡渍"],
      ["玻璃保鲜盒", "刀具餐具", ["保鲜盒", "饭盒"], ["收纳", "冷藏", "加热"], "检查密封圈，玻璃盒避免冷热骤变"],
      ["筷子", "刀具餐具", ["餐筷"], ["用餐"], "木筷定期更换，使用后彻底晾干"],
      ["汤匙", "刀具餐具", ["勺子", "餐勺"], ["用餐", "盛取"], "清洗后擦干，避免长期浸泡"],
      ["锅铲", "刀具餐具", ["炒铲", "铲子"], ["炒", "翻面"], "不粘锅优先使用硅胶或木质锅铲"],
      ["漏勺", "刀具餐具", ["滤勺", "捞勺"], ["捞取", "沥水"], "清洁网孔后彻底晾干"],
      ["厨房夹", "刀具餐具", ["食物夹", "夹子"], ["翻面", "夹取"], "清洗转轴处，保持开合顺畅"],
      ["削皮器", "刀具餐具", ["刮皮刀"], ["切配"], "刀片锋利，收纳时避免裸露"],
      ["开罐器", "刀具餐具", ["罐头刀"], ["开罐"], "使用后清洁刀轮并擦干"],
      ["滤网", "刀具餐具", ["筛网", "漏网"], ["过滤", "沥水"], "及时清除网孔残渣并晾干"],
      ["沥水篮", "刀具餐具", ["洗菜篮"], ["沥水", "清洗"], "使用后清洁并保持干燥"],
      ["擀面杖", "烘焙工具", ["擀面棒"], ["烘焙", "擀面"], "木质款避免长时间浸水"],
      ["厨房剪刀", "刀具餐具", ["剪刀"], ["切配"], "使用后清洁刀口并擦干"],
      ["调味罐", "刀具餐具", ["调料盒", "香料罐"], ["收纳", "调味"], "保持干燥并定期清洁罐口"],
      ["密封罐", "刀具餐具", ["储物罐", "干货罐"], ["收纳"], "定期检查密封圈，避免潮湿食材直接入罐"],
    ];
    const seedCatalog = db.transaction(() => catalogItems.forEach(([name, category, aliases, methods, care]) => insertCatalog.run(name, category, JSON.stringify(aliases), JSON.stringify(methods), care)));
    seedCatalog();
  }

  // 3. Diet Records
  db.exec(`
    CREATE TABLE IF NOT EXISTS diet_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      meal_type TEXT NOT NULL,
      food_name TEXT NOT NULL,
      amount TEXT NOT NULL,
      calories INTEGER,
      protein REAL DEFAULT 0,
      carbs REAL DEFAULT 0,
      fat REAL DEFAULT 0,
      image_url TEXT,
      recorded_at TEXT NOT NULL,
      recorded_time TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 4. Health Data
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      weight REAL,
      body_fat REAL,
      water_ml INTEGER DEFAULT 0,
      height_cm REAL,
      waist_cm REAL,
      hip_cm REAL,
      resting_heart_rate INTEGER,
      blood_pressure_systolic INTEGER,
      blood_pressure_diastolic INTEGER,
      blood_glucose_mmol REAL,
      cycle_status TEXT,
      sleep_hours REAL,
      recorded_date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 5. Recipes
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      cook_time INTEGER,
      difficulty TEXT,
      calories INTEGER,
      protein REAL,
      carbs REAL,
      fat REAL,
      nutrition_json TEXT,
      category TEXT,
      tags TEXT,
      steps_json TEXT,
      ingredients_json TEXT,
      author_user_id INTEGER,
      source TEXT DEFAULT 'official',
      status TEXT DEFAULT 'approved',
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      reject_reason TEXT,
      external_id TEXT,
      source_url TEXT,
      data_license TEXT,
      source_revision TEXT,
      source_attribution TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS recipe_favorites (
      user_id INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, recipe_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_recipe_favorites_user_created
    ON recipe_favorites(user_id, created_at DESC);
  `);

  // 6. Community Posts
  db.exec(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      nickname TEXT,
      avatar_url TEXT,
      category TEXT DEFAULT '寻味',
      content TEXT NOT NULL,
      image_url TEXT,
      image_urls TEXT,
      event_start_at DATETIME,
      event_end_at DATETIME,
      question_status TEXT DEFAULT 'open',
      accepted_comment_id INTEGER,
      likes_count INTEGER DEFAULT 0,
      views_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      deleted_at DATETIME,
      deleted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS community_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      nickname TEXT,
      avatar_url TEXT,
      content TEXT NOT NULL,
      image_url TEXT,
      likes_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS community_post_likes (
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS community_comment_likes (
      comment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (comment_id, user_id),
      FOREIGN KEY (comment_id) REFERENCES community_comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS community_event_participants (
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 7. Ingredients Library (Official)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredients_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      calories_100g REAL NOT NULL,
      protein_100g REAL,
      carbs_100g REAL,
      fat_100g REAL,
      image_url TEXT,
      source TEXT DEFAULT 'system',
      barcode TEXT,
      brands TEXT,
      micronutrients_json TEXT,
      data_license TEXT,
      deleted_at DATETIME,
      deleted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 8. User Custom Foods (UGC)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_custom_foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      calories_100g REAL NOT NULL,
      protein_100g REAL DEFAULT 0,
      carbs_100g REAL DEFAULT 0,
      fat_100g REAL DEFAULT 0,
      category TEXT DEFAULT '自定义',
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 12. Admin Audit Logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      summary TEXT NOT NULL,
      details_json TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
    ON admin_audit_logs(created_at);

    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_created_at
    ON admin_audit_logs(admin_user_id, created_at);
  `);

  // 9. System Settings (AI Config, Provider Settings, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 10. User Health Profiles
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_health_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      gender TEXT DEFAULT NULL,
      age INTEGER,
      height REAL,
      weight REAL,
      target_weight REAL,
      health_goal TEXT DEFAULT NULL,
      activity_level TEXT DEFAULT NULL,
      dietary_preference TEXT DEFAULT NULL,
      allergies_json TEXT DEFAULT '[]',
      medications TEXT DEFAULT '',
      medical_conditions_json TEXT DEFAULT '[]',
      medical_notes TEXT DEFAULT '',
      dietary_restrictions_json TEXT DEFAULT '[]',
      disliked_foods TEXT DEFAULT '',
      kitchen_constraints_json TEXT DEFAULT '{}',
      nutrition_targets_json TEXT DEFAULT '{}',
      tracking_enabled INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 11. AI Usage Logs (用量统计)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      estimated_cost_usd REAL DEFAULT 0,
      failure_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Durable image-recognition jobs. Keeping the job server-side means a user can
  // close the entry sheet or the app after upload without losing the AI result.
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_scan_jobs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      image_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      result_json TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_scan_jobs_user_hash
    ON inventory_scan_jobs(user_id, image_hash, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_inventory_scan_jobs_user_status
    ON inventory_scan_jobs(user_id, status, updated_at DESC);
  `);
  db.prepare(`
    UPDATE inventory_scan_jobs
    SET status = 'failed', error_message = '识别任务超时，请重新上传图片', updated_at = CURRENT_TIMESTAMP
    WHERE status IN ('queued', 'processing') AND updated_at < datetime('now', '-15 minutes')
  `).run();

  // Per-turn chat audit, scoped to an authenticated user and visible only to admins.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      response_time_ms INTEGER,
      source TEXT NOT NULL DEFAULT 'assistant',
      status TEXT NOT NULL DEFAULT 'completed',
      payload_json TEXT,
      confirmation_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session
    ON ai_chat_messages(user_id, session_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_created_at
    ON ai_chat_messages(created_at DESC);
  `);

  // 13. Household Family Sharing Tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      owner_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS household_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(household_id, user_id),
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS household_inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      food_name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity TEXT NOT NULL,
      expiration_date TEXT NOT NULL,
      storage_location TEXT DEFAULT '冷藏',
      image_url TEXT,
      is_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS household_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL,
      operator_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      food_name TEXT NOT NULL,
      quantity TEXT NOT NULL,
      storage_location TEXT DEFAULT '冷藏',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('issue', 'suggestion', 'support')),
      content TEXT NOT NULL,
      context_json TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at
    ON ai_usage_logs(created_at);

    CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_created_at
    ON ai_usage_logs(user_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_user_feedback_user_created
    ON user_feedback(user_id, created_at DESC);
  `);
  const aiRetentionDays = Math.max(1, Number(process.env.AI_CONVERSATION_RETENTION_DAYS) || 90);
  db.prepare("DELETE FROM ai_chat_messages WHERE created_at < datetime('now', ?)")
    .run(`-${aiRetentionDays} days`);

  runMigrations(db);
  ensureSchemaCompatibility();
  db.prepare("DELETE FROM ai_chat_session_deletions WHERE deleted_at < datetime('now', ?)")
    .run(`-${aiRetentionDays} days`);
  const expiredAgentThreads = db.prepare("SELECT checkpoint_thread_id FROM agent_runs WHERE created_at < datetime('now', ?)")
    .all(`-${aiRetentionDays} days`) as Array<{ checkpoint_thread_id: string }>;
  if (expiredAgentThreads.length && db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'").get()) {
    const deleteWrites = db.prepare("DELETE FROM writes WHERE thread_id = ?");
    const deleteCheckpoints = db.prepare("DELETE FROM checkpoints WHERE thread_id = ?");
    for (const thread of expiredAgentThreads) {
      deleteWrites.run(thread.checkpoint_thread_id);
      deleteCheckpoints.run(thread.checkpoint_thread_id);
    }
  }
  db.prepare("DELETE FROM agent_runs WHERE created_at < datetime('now', ?)").run(`-${aiRetentionDays} days`);
  db.prepare("DELETE FROM rate_limit_buckets WHERE updated_at < datetime('now', '-2 days')").run();

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
  `);


  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_community_posts_deleted_at ON community_posts(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_community_posts_feed_page ON community_posts(deleted_at, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_community_comments_post_created ON community_comments(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_community_event_participants_post ON community_event_participants(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recipes_deleted_at ON recipes(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_recipes_status_source ON recipes(status, source, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_recipes_author_created_at ON recipes(author_user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_source_external_id
    ON recipes(source, external_id)
    WHERE external_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_ingredients_library_deleted_at ON ingredients_library(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_ingredients_library_barcode ON ingredients_library(barcode);
  `);

  db.exec(`
    UPDATE users SET is_verified_expert = 1 WHERE username = 'nutritionist_lisa';
    UPDATE community_posts
    SET
      event_start_at = COALESCE(event_start_at, created_at),
      event_end_at = COALESCE(event_end_at, datetime(created_at, '+7 days'))
    WHERE category = '活动';
    UPDATE community_posts
    SET question_status = CASE WHEN accepted_comment_id IS NULL THEN 'open' ELSE 'resolved' END
    WHERE category = '问答';
  `);

  db.exec(`
    UPDATE recipes
    SET
      source = COALESCE(source, 'official'),
      status = COALESCE(status, 'approved'),
      updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
  `);

  // Use a bundled cover image for this fixture so mock content is still complete
  // when the device cannot reach an external image host.
  db.prepare(`
    UPDATE community_posts
    SET image_url = ?
    WHERE username = 'diet_helper'
      AND content LIKE '夏天的低卡宵夜：海苔豆腐汤%'
      AND image_url <> ?
  `).run('http://localhost:9090/media/community/tofu-seaweed-soup.png', 'http://localhost:9090/media/community/tofu-seaweed-soup.png');

  ensureAdminUser();
  // Traceable, license-labelled food and recipe catalogs are product data, not
  // demo accounts. Keep them available on an empty staging/production database
  // while leaving synthetic users and community activity disabled.
  seedIngredientsData();
  seedExpandedRecipesData();
  if (process.env.ENABLE_DEMO_SEED === '1') {
    seedDefaultData();
    seedExpandedCommunityPosts();
  }
}

export function getSystemSetting(key: string, defaultValue = ""): string {
  try {
    const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key) as any;
    return row?.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

function seedExpandedCommunityPosts() {
  // Additive seed: existing installations keep user-created posts and receive a
  // fuller, more varied feed once.  The timestamp offsets make the ranking feed
  // feel alive instead of presenting every seed item as published simultaneously.
  const userIds = new Map(
    (db.prepare("SELECT id, nickname AS seed_key FROM users WHERE nickname IN ('demo', 'chef_david', 'family_kitchen', 'nutritionist_lisa', 'fitness_jack', 'diet_helper')").all() as Array<{ id: number; seed_key: string }>)
      .map((user) => [user.seed_key, user.id])
  );
  const userId = userIds.get('demo')!;
  const u2 = userIds.get('chef_david')!;
  const u3 = userIds.get('family_kitchen')!;
  const u4 = userIds.get('nutritionist_lisa')!;
  const u5 = userIds.get('fitness_jack')!;
  const u6 = userIds.get('diet_helper')!;
  const expandedPostCount = db.prepare('SELECT COUNT(*) as count FROM community_posts').get() as { count: number };
  if (expandedPostCount.count < 70) {
    const insertExpandedPost = db.prepare(`
      INSERT INTO community_posts (user_id, username, nickname, avatar_url, category, content, image_url, likes_count, comment_count, views_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);
    const expandedPosts: Array<[number, string, string, string, string, string, string, number, number, number, string]> = [
      [u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '寻味', '15 分钟高蛋白番茄虾仁意面：用全麦意面和番茄酱，晚归也能吃得满足又轻盈。', 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=800&auto=format&fit=crop&q=80', 326, 42, 1260, '-45 minutes'],
      [u3, 'family_kitchen', '元气烘焙日记', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', '寻味', '冰箱里剩半盒豆腐？试试香煎豆腐配菌菇，低脂又下饭，附不粘锅火候小诀窍。', 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format&fit=crop&q=80', 189, 27, 875, '-2 hours'],
      [u5, 'fitness_jack', '健身达人Jack', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', '寻味', '训练后不想喝粉？这一碗牛肉彩椒糙米饭有 38g 蛋白质，饱腹感拉满。', 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format&fit=crop&q=80', 412, 56, 1830, '-4 hours'],
      [u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '问答', '晚餐吃水果能代替正餐吗？从蛋白质、饱腹感和血糖波动三个角度讲清楚。', 'https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?w=800&auto=format&fit=crop&q=80', 538, 91, 2240, '-5 hours'],
      [u6, 'diet_helper', '减脂小助手', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '榜单', '本周低糖酸奶配料表榜单：从蛋白质、添加糖和口感，帮你挑出 5 款通勤好搭子。', 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&auto=format&fit=crop&q=80', 766, 104, 3400, '-6 hours'],
      [userId, 'demo', '绿色食物分享家', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', '活动', '#一周不重样早餐# Day 3：隔夜燕麦加蓝莓和坚果，早上多睡 20 分钟也不慌。', 'https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=800&auto=format&fit=crop&q=80', 274, 38, 1180, '-8 hours'],
      [u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '问答', '控糖不是完全不吃碳水：白米、杂粮和薯类怎样安排份量更稳妥？', 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=80', 685, 116, 2980, '-10 hours'],
      [u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '榜单', '空气炸锅高分食材 TOP 5：鸡翅、豆腐、南瓜、虾仁和口蘑的时间温度一次整理。', 'https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop&q=80', 921, 127, 4020, '-12 hours'],
      [u3, 'family_kitchen', '元气烘焙日记', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', '活动', '#冰箱清库存挑战# 用西兰花、鸡蛋和玉米做了一盘彩色焗饭，评论区晒出你的版本！', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop&q=80', 354, 63, 1490, '-14 hours'],
      [u5, 'fitness_jack', '健身达人Jack', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', '问答', '增肌期蛋白质怎么分配到三餐？不必每餐都吃鸡胸，给你一套更好坚持的组合。', 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=800&auto=format&fit=crop&q=80', 603, 88, 2570, '-16 hours'],
      [u6, 'diet_helper', '减脂小助手', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '寻味', '夏天的低卡宵夜：海苔豆腐汤加一小份毛豆，温暖、低脂也有咀嚼感。', 'http://localhost:9090/media/community/tofu-seaweed-soup.png', 148, 19, 690, '-18 hours'],
      [userId, 'demo', '绿色食物分享家', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', '榜单', '家庭常备冷冻蔬菜红榜：西兰花、菠菜、玉米粒怎么选，营养和便利性兼顾。', 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80', 489, 74, 2010, '-20 hours'],
      [u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '活动', '#10分钟晚餐接力# 今天做了黑椒口蘑鸡腿肉，谁来接下一道快手菜？', 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=800&auto=format&fit=crop&q=80', 231, 33, 990, '-22 hours'],
      [u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc9944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '问答', '减脂遇到平台期，先别急着继续少吃：睡眠、步数和蛋白质都可能是答案。', 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&auto=format&fit=crop&q=80', 882, 143, 3850, '-1 day'],
      [u3, 'family_kitchen', '元气烘焙日记', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', '寻味', '无糖香蕉燕麦松饼成功了！只用香蕉、鸡蛋和燕麦，周末早餐香到邻居来敲门。', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80', 367, 52, 1580, '-28 hours'],
      [u5, 'fitness_jack', '健身达人Jack', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', '榜单', '高蛋白零食实测榜：常温可放、适合健身包，避开那些“看着健康”但糖很高的选择。', 'https://images.unsplash.com/photo-1511690656952-34342bb7c2f2?w=800&auto=format&fit=crop&q=80', 715, 99, 3110, '-32 hours'],
      [u6, 'diet_helper', '减脂小助手', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '活动', '#喝水也要打卡# 今天完成 2000ml 的朋友来报到，附一份不爱喝白水的调味灵感。', 'https://images.unsplash.com/photo-1548839140-29a749e1cf4e?w=800&auto=format&fit=crop&q=80', 305, 47, 1310, '-36 hours'],
      [userId, 'demo', '绿色食物分享家', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', '问答', '买坚果时到底选原味还是烘焙？一把的份量是多少？把常见误区整理成图。', 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&auto=format&fit=crop&q=80', 429, 61, 1760, '-40 hours'],
      [u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '寻味', '一锅番茄牛肉蔬菜汤：周日晚间煮好分装，工作日午餐加热就能吃。', 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format&fit=crop&q=80', 571, 79, 2440, '-2 days'],
      [u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc9944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '榜单', '膳食纤维食材榜：除了西兰花，豆类、燕麦和菌菇也都是提升饱腹感的好选择。', 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&auto=format&fit=crop&q=80', 802, 128, 3510, '-3 days']
,
      [u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '寻味', '空气炸锅迷迭香烤三文鱼与口蘑：180度12分钟，油脂自然渗出将口蘑慢烤至鲜嫩多汁！', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=800&auto=format&fit=crop&q=80', 642, 78, 2150, '-15 minutes'],
      [u5, 'fitness_jack', '健身达人Jack', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', '寻味', '夏日彩椒水煮牛肉高蛋白能量碗：牛肉快速飞水，搭配紫甘蓝和温泉蛋，含 42g 优质蛋白！', 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&auto=format&fit=crop&q=80', 489, 53, 1720, '-1 hour'],
      [u3, 'family_kitchen', '元气烘焙日记', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', '寻味', '零失败无糖奇亚籽椰奶燕麦杯：冷藏吸饱椰奶，挤上新鲜百香果汁，口感媲美高端甜品！', 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=800&auto=format&fit=crop&q=80', 815, 94, 3200, '-3 hours'],
      [userId, 'demo', '绿色食物分享家', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', '寻味', '泰式柠檬青榨虾仁凉拌魔芋粉丝：基围虾过冰水，黑胡椒酸辣开胃，热量不到 200 大卡！', 'https://images.unsplash.com/photo-1551248429-40975aa4de74?w=800&auto=format&fit=crop&q=80', 378, 41, 1450, '-7 hours'],
      [u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '寻味', '地中海风味香煎鸡胸肉配慢烤贝贝南瓜：提前用牛至叶蒜末腌制，外焦里嫩饱腹满分！', 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=800&auto=format&fit=crop&q=80', 520, 62, 1980, '-11 hours'],
      [u6, 'diet_helper', '减脂小助手', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '寻味', '无油空气炸老豆腐金针菇煲：老豆腐炸至金黄，铺在金针菇上蒜蓉小火焖煮，入味无负担。', 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format&fit=crop&q=80', 733, 89, 2840, '-15 hours'],
      [u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '寻味', '早晨第一杯抹茶羽衣甘蓝高纤抗氧饮：羽衣甘蓝配半根黄瓜与无糖绿茶打碎，肠道轻松一整天。', 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=800&auto=format&fit=crop&q=80', 912, 110, 3900, '-1 day'],

      [u6, 'diet_helper', '减脂小助手', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '榜单', '🏆 2026便利店控糖加餐热度榜：1.无糖高纤豆浆 2.即食水煮蛋白 3.卤香毛豆 4.希腊酸奶 5.85%黑巧！', 'https://images.unsplash.com/photo-1608219992759-8d74ed8d76eb?w=800&auto=format&fit=crop&q=80', 1420, 185, 6100, '-30 minutes'],
      [u5, 'fitness_jack', '健身达人Jack', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', '榜单', '🥇 高蛋白食材性价比实测榜：鸡胸肉（纯蛋白性价比之王）> 鸡蛋 > 巴沙鱼 > 老豆腐 > 瘦牛腱子！', 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&auto=format&fit=crop&q=80', 1180, 142, 4950, '-2 hours'],
      [u3, 'family_kitchen', '元气烘焙日记', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', '榜单', '🌟 提升减脂幸福感的厨房神器 TOP 4：0.1g精度电子秤、喷雾橄榄油瓶、玻璃密封分装盒！', 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop&q=80', 890, 97, 3420, '-5 hours'],
      [u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '榜单', '📊 告别高油高糖！4款自制低卡沙拉酱：酸奶蒜香酱、日式和风醋汁、泰式青柠酱、芥末黑醋汁！', 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&auto=format&fit=crop&q=80', 1050, 128, 4300, '-9 hours'],
      [userId, 'demo', '绿色食物分享家', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', '榜单', '🏆 常温高蛋白坚果加餐榜：巴旦木、腰果、南瓜籽与无糖风干牛肉粒，满足嚼劲不升糖。', 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&auto=format&fit=crop&q=80', 670, 72, 2700, '-18 hours'],

      [userId, 'demo', '绿色食物分享家', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', '活动', '🔥 #30天减脂餐早安打卡# Day 14：全麦吐司配半颗牛油果与水煮蛋。8,900 位食友在线打卡！', 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format&fit=crop&q=80', 950, 132, 3890, '-20 minutes'],
      [u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '活动', '🥗 #彩虹饮食法7天挑战赛# 第一天：红黄绿紫白5色食材搭配，吃出天然抗氧化好气色！', 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80', 830, 104, 3100, '-3 hours'],
      [u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '活动', '🍳 #15分钟快手健康晚餐接力# 今晚分享【黑椒蒜香炒虾仁】！8分钟出锅，快来接力！', 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format&fit=crop&q=80', 610, 85, 2540, '-8 hours'],
      [u6, 'diet_helper', '减脂小助手', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '活动', '🍱 #自制低卡办公室便当大赛# 晒出你精心准备的精致便当！连续7天打卡赢取专属徽章！', 'https://images.unsplash.com/photo-1511690656952-34342bb7c2f2?w=800&auto=format&fit=crop&q=80', 770, 92, 2900, '-16 hours'],

      [u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '问答', '❓ 【专家解答】练后30-60分钟是肌肉合成黄金期！补充 20-30g 蛋白质与快吸收碳水效果最佳。', 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&auto=format&fit=crop&q=80', 1250, 168, 5200, '-10 minutes'],
      [u5, 'fitness_jack', '健身达人Jack', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', '问答', '💡 【食友提问】长期低碳水饮食需要注意什么？解析适应期、电解质补充技巧与碳水循环策略。', 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&auto=format&fit=crop&q=80', 930, 114, 3950, '-2.5 hours'],
      [u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '问答', '🥑 【营养问答】特级初榨橄榄油烟点约为 190°C-210°C，中火短时间小炒完全安全无忧！', 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&auto=format&fit=crop&q=80', 870, 96, 3500, '-6 hours'],
      [u3, 'family_kitchen', '元气烘焙日记', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', '问答', '🍞 【食友求助】配料表第一位必须是全麦粉！如果第一位是小麦粉或预拌粉，都是假全麦。', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80', 1040, 135, 4100, '-14 hours']
    ];
    const seedExpandedPosts = db.transaction(() => expandedPosts.forEach((post) => insertExpandedPost.run(...post)));
    seedExpandedPosts();
  }

  seedCommunityComments();
}

function seedCommunityComments() {
  const commentCount = (db.prepare('SELECT COUNT(*) as count FROM community_comments').get() as any).count;
  if (commentCount < 30) {
    const userIds = new Map(
      (db.prepare("SELECT id, nickname AS seed_key FROM users WHERE nickname IN ('demo', 'chef_david', 'family_kitchen', 'nutritionist_lisa', 'fitness_jack', 'diet_helper')").all() as Array<{ id: number; seed_key: string }>)
        .map((user) => [user.seed_key, user.id])
    );
    const userId = userIds.get('demo')!;
    const u2 = userIds.get('chef_david')!;
    const u3 = userIds.get('family_kitchen')!;
    const u4 = userIds.get('nutritionist_lisa')!;
    const u5 = userIds.get('fitness_jack')!;
    const u6 = userIds.get('diet_helper')!;

    const posts = db.prepare('SELECT id, category, username FROM community_posts ORDER BY id ASC LIMIT 50').all() as Array<{ id: number; category: string; username: string }>;
    const insertComment = db.prepare(`
      INSERT INTO community_comments (post_id, user_id, username, nickname, avatar_url, content, likes_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    `);

    const commentsToInsert: Array<[number, number, string, string, string, string, number, string]> = [];

    posts.forEach((p) => {
      if (p.category === '寻味') {
        commentsToInsert.push(
          [p.id, u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '这款搭配非常赞！蛋白质与复合碳水比例合理，继续保持哦！', 18, '-30 minutes'],
          [p.id, u3, 'family_kitchen', '元气烘焙日记', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', '看着太有食欲了，今晚我也按照这个配方试试看！', 12, '-1 hour']
        );
      } else if (p.category === '问答') {
        commentsToInsert.push(
          [p.id, u4, 'nutritionist_lisa', '注册营养师Lisa', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80', '这是一个非常经典的疑问！总结起来关键看三点：1. 蛋白质质量 2. 膳食纤维协同 3. 消化吸收速率。合理搭配才能既控糖又有饱腹感。', 35, '-45 minutes'],
          [p.id, u2, 'chef_david', '主厨David', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', '从烹饪角度补充一句：尽量采用中火慢煎或水蒸，能锁住肉汁避免发柴发干。', 24, '-2 hours']
        );
      } else if (p.category === '活动') {
        commentsToInsert.push(
          [p.id, userId, 'demo', '绿色食物分享家', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', '已完成今日打卡！感觉身体状态越来越轻松啦 💪', 15, '-10 minutes'],
          [p.id, u5, 'fitness_jack', '健身达人Jack', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', '加油组员们！坚持打卡，组队打卡动力更足！', 20, '-40 minutes']
        );
      } else if (p.category === '榜单') {
        commentsToInsert.push(
          [p.id, u6, 'diet_helper', '减脂小助手', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80', '这份榜单整理得太详细了，立刻收藏去超市长线采购！', 28, '-1 hour']
        );
      }
    });

    const seedTx = db.transaction(() => {
      commentsToInsert.forEach((c) => insertComment.run(...c));
      db.prepare(`
        UPDATE community_posts
        SET comment_count = (SELECT COUNT(*) FROM community_comments WHERE community_comments.post_id = community_posts.id)
        WHERE id IN (SELECT DISTINCT post_id FROM community_comments)
      `).run();
    });
    seedTx();
  }
}

function seedIngredientsData() {
  const insert = db.prepare(`
    INSERT INTO ingredients_library (
      name, normalized_name, category, calories_100g, protein_100g, carbs_100g, fat_100g,
      source, source_version, source_updated_at, data_license, nutrition_basis, quality_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'usda_fdc_foundation', 'USDA-FDC-foundation-seed-v1',
      CURRENT_TIMESTAMP, 'US-Public-Domain', 'per_100g', 'trusted')
  `);
  const exists = db.prepare('SELECT id, source FROM ingredients_library WHERE name = ? AND deleted_at IS NULL LIMIT 1');
  const repairGovernance = db.prepare(`
    UPDATE ingredients_library SET
      normalized_name = COALESCE(normalized_name, ?),
      source_version = COALESCE(source_version, 'USDA-FDC-foundation-seed-v1'),
      source_updated_at = COALESCE(source_updated_at, created_at, CURRENT_TIMESTAMP),
      data_license = COALESCE(data_license, 'US-Public-Domain'),
      nutrition_basis = COALESCE(nutrition_basis, 'per_100g'),
      quality_status = COALESCE(quality_status, 'trusted')
    WHERE id = ? AND source = 'usda_fdc_foundation'
  `);
  const insertAlias = db.prepare(`
    INSERT OR IGNORE INTO ingredient_aliases (ingredient_id, alias, normalized_alias, alias_type)
    VALUES (?, ?, ?, 'canonical')
  `);
  const insertPortion = db.prepare(`
    INSERT OR IGNORE INTO ingredient_portions (ingredient_id, label, grams, source, source_version)
    VALUES (?, '100克', 100, 'usda_fdc_foundation', 'USDA-FDC-foundation-seed-v1')
  `);
  const normalize = (value: string) => value.toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[\s·、，,。()（）/\\_-]/g, '')
    .trim();

  // 营养数值来自 USDA FoodData Central 的公开 Foundation / SR Legacy 数据（每 100g）。
  // 只补充缺少的名称，不覆盖管理员或用户已经维护的条目。
  const foods = [
      ['鸡蛋(全蛋)', '蛋奶', 144, 13.3, 2.8, 8.8],
      ['鸡胸肉(生)', '肉类', 118, 24.6, 0.6, 1.9],
      ['瘦牛肉', '肉类', 106, 20.2, 0, 2.3],
      ['三文鱼', '肉类', 139, 17.2, 0, 7.8],
      ['大米(生)', '主食', 346, 7.9, 77.2, 0.8],
      ['糙米(生)', '主食', 348, 7.3, 76.8, 2.7],
      ['燕麦片', '主食', 377, 15, 66.9, 6.7],
      ['西红柿', '蔬菜', 15, 0.9, 3.3, 0.2],
      ['西兰花', '蔬菜', 36, 4.1, 4.3, 0.6],
      ['菠菜', '蔬菜', 28, 2.6, 4.5, 0.3],
      ['苹果', '水果', 53, 0.2, 13.5, 0.2],
      ['香蕉', '水果', 93, 1.4, 22, 0.2],
      ['全脂牛奶', '蛋奶', 62, 3, 4.7, 3.2],
      ['无糖酸奶', '蛋奶', 67, 3.8, 4.9, 3.2],
      ['牛油果', '水果', 171, 2, 7.4, 15.3],
      ['土豆', '主食', 81, 2.6, 17.8, 0.2],
      ['红薯', '主食', 86, 1.6, 20.1, 0.2],
      ['杏仁', '坚果', 578, 21.2, 21.6, 50.6],
      ['核桃', '坚果', 646, 14.9, 19.1, 58.8],
      ['黄瓜', '蔬菜', 16, 0.8, 2.9, 0.2],
      ['芦笋', '蔬菜', 20, 2.2, 3.9, 0.1],
      ['生菜', '蔬菜', 15, 1.4, 2.9, 0.2],
      ['胡萝卜', '蔬菜', 41, 0.9, 9.6, 0.2],
      ['彩椒', '蔬菜', 31, 1, 6, 0.3],
      ['洋葱', '蔬菜', 40, 1.1, 9.3, 0.1],
      ['西葫芦', '蔬菜', 17, 1.2, 3.1, 0.3],
      ['茄子', '蔬菜', 25, 1, 5.9, 0.2],
      ['南瓜', '蔬菜', 26, 1, 6.5, 0.1],
      ['玉米', '蔬菜', 86, 3.4, 18.7, 1.4],
      ['豌豆', '蔬菜', 81, 5.4, 14.5, 0.4],
      ['四季豆', '蔬菜', 31, 1.8, 7, 0.2],
      ['芹菜', '蔬菜', 16, 0.7, 3, 0.2],
      ['菜花', '蔬菜', 25, 1.9, 5, 0.3],
      ['卷心菜', '蔬菜', 25, 1.3, 5.8, 0.1],
      ['羽衣甘蓝', '蔬菜', 49, 4.3, 8.8, 0.9],
      ['蘑菇', '蔬菜', 22, 3.1, 3.3, 0.3],
      ['番薯叶', '蔬菜', 42, 2.5, 7.4, 0.5],
      ['草莓', '水果', 32, 0.7, 7.7, 0.3],
      ['蓝莓', '水果', 57, 0.7, 14.5, 0.3],
      ['橙子', '水果', 47, 0.9, 11.8, 0.1],
      ['猕猴桃', '水果', 61, 1.1, 14.7, 0.5],
      ['葡萄柚', '水果', 42, 0.8, 10.7, 0.1],
      ['梨', '水果', 57, 0.4, 15.2, 0.1],
      ['芒果', '水果', 60, 0.8, 15, 0.4],
      ['鸡腿肉(去皮)', '肉类', 119, 19.6, 0, 4.7],
      ['猪里脊', '肉类', 143, 21.2, 0, 6.2],
      ['虾仁', '肉类', 99, 24, 0.2, 0.3],
      ['鳕鱼', '肉类', 82, 17.8, 0, 0.7],
      ['金枪鱼(水浸)', '肉类', 116, 25.5, 0, 0.8],
      ['豆腐(北豆腐)', '豆制品', 81, 8.1, 1.7, 4.2],
      ['豆腐(嫩豆腐)', '豆制品', 55, 5.3, 1.9, 2.8],
      ['毛豆', '豆制品', 121, 11.9, 8.9, 5.2],
      ['鹰嘴豆(熟)', '豆制品', 164, 8.9, 27.4, 2.6],
      ['黑豆(熟)', '豆制品', 132, 8.9, 23.7, 0.5],
      ['低脂牛奶', '蛋奶', 42, 3.4, 5, 1],
      ['希腊酸奶(无糖)', '蛋奶', 59, 10.2, 3.6, 0.4],
      ['低脂奶酪', '蛋奶', 173, 24.4, 3.1, 7],
      ['藜麦(熟)', '主食', 120, 4.4, 21.3, 1.9],
      ['全麦面包', '主食', 247, 13, 41, 4.2],
      ['全麦意面(熟)', '主食', 149, 5.3, 31.2, 0.9],
      ['荞麦面(熟)', '主食', 99, 5.1, 21.4, 0.1],
      ['玉米饼', '主食', 218, 5.7, 45.8, 2.8],
      ['奇亚籽', '坚果', 486, 16.5, 42.1, 30.7],
      ['亚麻籽', '坚果', 534, 18.3, 28.9, 42.2],
      ['花生酱(无糖)', '坚果', 588, 25.1, 20, 50.4],
      ['橄榄油', '调味料', 884, 0, 0, 100],
      ['蜂蜜', '调味料', 304, 0.3, 82.4, 0],
    ] as const;

  const transaction = db.transaction(() => {
    for (const food of foods) {
      const normalizedName = normalize(food[0]);
      const existing = exists.get(food[0]) as { id: number; source: string } | undefined;
      const ingredientId = existing
        ? existing.id
        : Number(insert.run(food[0], normalizedName, ...food.slice(1)).lastInsertRowid);
      // A same-name administrator record remains administrator-owned. Only
      // repair metadata and derived indexes for this bundled USDA catalog.
      if (existing && existing.source !== 'usda_fdc_foundation') continue;
      repairGovernance.run(normalizedName, ingredientId);
      insertAlias.run(ingredientId, food[0], normalizedName);
      insertPortion.run(ingredientId);
    }
  });
  transaction();
}

/**
 * 补齐可浏览的营养食谱。营养估算以 USDA FoodData Central 的每 100g 公开数据为基础，
 * 不依赖外部服务，因此离线和首次启动也有足够内容可用。
 */
function seedExpandedRecipesData() {
  const normalize = (value: string) => value.toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[\s·、，,。()（）/\\_-]/g, '')
    .trim();
  const exists = db.prepare(`
    SELECT id, source FROM recipes WHERE title = ? AND deleted_at IS NULL LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO recipes (
      title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat,
      category, tags, steps_json, ingredients_json, source, status, quality_status, nutrition_basis,
      canonical_key, source_content_hash, serving_size, prep_time, required_kitchenware_json,
      data_license, source_revision, source_attribution, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usda_based', 'approved', 'trusted',
      'ingredient_estimate', ?, ?, 1, 10, '["菜刀"]', 'DietDigiDose-Original',
      'usda-based-catalog-v1', 'DietDigiDose 编辑团队；营养估算基于 USDA FoodData Central', CURRENT_TIMESTAMP)
  `);
  const repairGovernance = db.prepare(`
    UPDATE recipes SET
      quality_status = COALESCE(quality_status, 'trusted'),
      nutrition_basis = CASE WHEN nutrition_basis IS NULL OR nutrition_basis = 'source' THEN 'ingredient_estimate' ELSE nutrition_basis END,
      canonical_key = COALESCE(canonical_key, ?),
      source_content_hash = COALESCE(source_content_hash, ?),
      serving_size = COALESCE(serving_size, 1),
      prep_time = COALESCE(prep_time, 10),
      required_kitchenware_json = CASE
        WHEN required_kitchenware_json IS NULL OR required_kitchenware_json = '[]' THEN '["菜刀"]'
        ELSE required_kitchenware_json
      END,
      data_license = COALESCE(data_license, 'DietDigiDose-Original'),
      source_revision = COALESCE(source_revision, 'usda-based-catalog-v1'),
      source_attribution = COALESCE(source_attribution, 'DietDigiDose 编辑团队；营养估算基于 USDA FoodData Central')
    WHERE id = ? AND source = 'usda_based'
  `);
  const image = 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format&fit=crop&q=80';
  const recipes: Array<{
    title: string; category: string; calories: number; protein: number; carbs: number; fat: number;
    time: number; ingredients: string[]; tags: string[];
  }> = [
    { title: '柠檬香草鸡胸西兰花盒', category: '减脂', calories: 355, protein: 42, carbs: 26, fat: 9, time: 20, ingredients: ['鸡胸肉 160g', '西兰花 180g', '糙米饭 100g'], tags: ['高蛋白', '低脂', '便当'] },
    { title: '虾仁牛油果彩虹沙拉', category: '减脂', calories: 328, protein: 29, carbs: 20, fat: 15, time: 12, ingredients: ['虾仁 150g', '牛油果 50g', '生菜 100g', '彩椒 80g'], tags: ['清爽', '高蛋白', '低碳水'] },
    { title: '番茄豆腐菌菇汤', category: '减脂', calories: 218, protein: 18, carbs: 22, fat: 7, time: 18, ingredients: ['嫩豆腐 200g', '西红柿 200g', '蘑菇 100g'], tags: ['暖胃', '低卡', '素食'] },
    { title: '清炒芦笋鳕鱼', category: '减脂', calories: 276, protein: 35, carbs: 13, fat: 10, time: 16, ingredients: ['鳕鱼 180g', '芦笋 160g', '橄榄油 8g'], tags: ['优质蛋白', '低脂', '一锅菜'] },
    { title: '鸡肉荞麦冷面', category: '减脂', calories: 385, protein: 32, carbs: 46, fat: 9, time: 20, ingredients: ['鸡胸肉 120g', '荞麦面 180g', '黄瓜 80g'], tags: ['清爽', '饱腹', '快手'] },
    { title: '鹰嘴豆烤南瓜沙拉', category: '减脂', calories: 342, protein: 14, carbs: 48, fat: 11, time: 25, ingredients: ['鹰嘴豆 120g', '南瓜 200g', '羽衣甘蓝 60g'], tags: ['高纤维', '植物蛋白', '烤箱菜'] },
    { title: '三文鱼糙米能量碗', category: '增肌', calories: 628, protein: 40, carbs: 65, fat: 23, time: 25, ingredients: ['三文鱼 180g', '糙米饭 180g', '毛豆 80g'], tags: ['增肌', 'Omega-3', '饱腹'] },
    { title: '黑椒牛肉藜麦饭', category: '增肌', calories: 590, protein: 43, carbs: 59, fat: 19, time: 22, ingredients: ['瘦牛肉 170g', '藜麦 180g', '彩椒 100g'], tags: ['高蛋白', '训练餐', '一锅饭'] },
    { title: '金枪鱼全麦意面', category: '增肌', calories: 548, protein: 39, carbs: 68, fat: 12, time: 18, ingredients: ['金枪鱼(水浸) 120g', '全麦意面 220g', '西红柿 150g'], tags: ['训练餐', '快手', '优质碳水'] },
    { title: '鸡腿肉玉米暖碗', category: '增肌', calories: 565, protein: 39, carbs: 58, fat: 18, time: 25, ingredients: ['鸡腿肉(去皮) 180g', '玉米 120g', '红薯 180g'], tags: ['增肌', '饱腹', '家庭餐'] },
    { title: '豆腐毛豆藜麦拌饭', category: '增肌', calories: 512, protein: 30, carbs: 63, fat: 17, time: 16, ingredients: ['北豆腐 180g', '毛豆 100g', '藜麦 180g'], tags: ['植物蛋白', '增肌', '无肉'] },
    { title: '猪里脊西葫芦全麦卷', category: '增肌', calories: 478, protein: 38, carbs: 46, fat: 15, time: 20, ingredients: ['猪里脊 160g', '全麦饼 2张', '西葫芦 100g'], tags: ['高蛋白', '便携', '快手'] },
    { title: '蓝莓奇亚籽酸奶杯', category: '营养餐单', calories: 298, protein: 20, carbs: 35, fat: 9, time: 8, ingredients: ['希腊酸奶 200g', '蓝莓 80g', '奇亚籽 12g'], tags: ['早餐', '高纤维', '免开火'] },
    { title: '花生酱香蕉燕麦奶昔', category: '营养餐单', calories: 410, protein: 18, carbs: 55, fat: 15, time: 5, ingredients: ['香蕉 1根', '燕麦片 40g', '花生酱 15g', '低脂牛奶 250ml'], tags: ['早餐', '能量补充', '5分钟'] },
    { title: '草莓全麦法式吐司', category: '营养餐单', calories: 365, protein: 21, carbs: 49, fat: 10, time: 15, ingredients: ['全麦面包 2片', '鸡蛋 1个', '草莓 100g', '低脂牛奶 80ml'], tags: ['早餐', '高蛋白', '少油'] },
    { title: '苹果核桃燕麦粥', category: '营养餐单', calories: 356, protein: 12, carbs: 54, fat: 11, time: 12, ingredients: ['燕麦片 50g', '苹果 1个', '核桃 12g', '低脂牛奶 200ml'], tags: ['早餐', '高纤维', '暖胃'] },
    { title: '橙香羽衣甘蓝酸奶昔', category: '营养餐单', calories: 245, protein: 15, carbs: 38, fat: 4, time: 5, ingredients: ['橙子 1个', '羽衣甘蓝 50g', '希腊酸奶 150g'], tags: ['维C', '早餐', '免开火'] },
    { title: '猕猴桃奇亚籽布丁', category: '营养餐单', calories: 276, protein: 15, carbs: 33, fat: 10, time: 10, ingredients: ['奇亚籽 25g', '低脂牛奶 200ml', '猕猴桃 1个'], tags: ['隔夜', '高纤维', '加餐'] },
    { title: '空气炸锅彩椒鸡肉串', category: '快手菜', calories: 336, protein: 40, carbs: 18, fat: 12, time: 18, ingredients: ['鸡胸肉 180g', '彩椒 120g', '洋葱 60g'], tags: ['空气炸锅', '高蛋白', '低脂'] },
    { title: '蘑菇菠菜滑蛋', category: '快手菜', calories: 268, protein: 23, carbs: 12, fat: 15, time: 10, ingredients: ['鸡蛋 2个', '蘑菇 120g', '菠菜 100g'], tags: ['10分钟', '早餐', '低碳水'] },
    { title: '番茄虾仁全麦意面', category: '快手菜', calories: 462, protein: 34, carbs: 57, fat: 11, time: 20, ingredients: ['虾仁 150g', '全麦意面 200g', '西红柿 180g'], tags: ['一锅菜', '高蛋白', '快手'] },
    { title: '牛油果鸡蛋全麦吐司', category: '快手菜', calories: 382, protein: 20, carbs: 36, fat: 18, time: 10, ingredients: ['全麦面包 2片', '鸡蛋 2个', '牛油果 60g'], tags: ['早餐', '10分钟', '优质脂肪'] },
    { title: '蒜香四季豆牛肉', category: '快手菜', calories: 394, protein: 34, carbs: 19, fat: 19, time: 16, ingredients: ['瘦牛肉 160g', '四季豆 180g', '橄榄油 8g'], tags: ['下饭菜', '高蛋白', '16分钟'] },
    { title: '玉米豌豆鸡蛋炒饭', category: '快手菜', calories: 486, protein: 20, carbs: 69, fat: 14, time: 15, ingredients: ['糙米饭 180g', '鸡蛋 2个', '玉米 80g', '豌豆 60g'], tags: ['一锅饭', '家常菜', '快手'] },
  ];

  const transaction = db.transaction(() => {
    for (const recipe of recipes) {
      const stepsJson = JSON.stringify(['将食材洗净并按用量切配。', '按食材特性加热、拌匀或组合，确保肉类和蛋类彻底熟透。', '装盘后按口味加入少量盐、黑胡椒或柠檬汁即可。']);
      const ingredientsJson = JSON.stringify(recipe.ingredients);
      const canonicalKey = normalize(recipe.title);
      const contentHash = crypto.createHash('sha256').update(JSON.stringify({
        title: canonicalKey,
        ingredients: ingredientsJson,
        steps: stepsJson,
        revision: 'usda-based-catalog-v1',
      })).digest('hex');
      const existing = exists.get(recipe.title) as { id: number; source: string } | undefined;
      const recipeId = existing
        ? existing.id
        : Number(insert.run(
          recipe.title,
          `按一人份设计的${recipe.category}食谱；营养数值为基于 USDA FoodData Central 公开食材数据的估算值。`,
          image,
          recipe.time,
          recipe.time <= 12 ? '简单' : '中等',
          recipe.calories,
          recipe.protein,
          recipe.carbs,
          recipe.fat,
          recipe.category,
          JSON.stringify(recipe.tags),
          stepsJson,
          ingredientsJson,
          canonicalKey,
          contentHash,
        ).lastInsertRowid);
      if (existing && existing.source !== 'usda_based') continue;
      repairGovernance.run(canonicalKey, contentHash, recipeId);
    }
  });
  transaction();
}

function ensureAdminUser() {
  const adminUser = db.prepare(`
    SELECT id, password_hash
    FROM users
    WHERE username = 'admin'
  `).get() as { id: number; password_hash: string } | undefined;
  if (!adminUser) {
    const configuredInitialPassword = process.env.ADMIN_INITIAL_PASSWORD?.trim();
    if (process.env.NODE_ENV === 'production' && (!configuredInitialPassword || configuredInitialPassword.length < 12)) {
      throw new Error('首次部署必须设置长度至少为 12 位的 ADMIN_INITIAL_PASSWORD');
    }
    if (configuredInitialPassword && !isPasswordWithinByteLimit(configuredInitialPassword)) throw new Error("ADMIN_INITIAL_PASSWORD 的 UTF-8 编码不能超过72字节");
    const bootstrapPassword = configuredInitialPassword || crypto.randomBytes(18).toString('base64url');
    const hash = bcrypt.hashSync(bootstrapPassword, bcrypt.genSaltSync(10));
    db.prepare(`
      INSERT INTO users (username, password_hash, avatar_url, bio, role, must_change_password)
      VALUES ('admin', ?, '', '系统管理员账号', 'admin', 1)
    `).run(hash);
    if (!configuredInitialPassword) console.warn(`[Security] 开发环境管理员一次性初始密码：${bootstrapPassword}`);
    return;
  }
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(adminUser.id);
  if (bcrypt.compareSync('123456', adminUser.password_hash)) {
    db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").run(adminUser.id);
    console.warn('[Security] 检测到旧版默认管理员密码，已要求下次登录强制修改。');
  }
}

function seedDefaultData() {
  const configuredDemoPassword = process.env.DEMO_USER_PASSWORD?.trim();
  if (configuredDemoPassword && configuredDemoPassword.length < 12) {
    throw new Error('DEMO_USER_PASSWORD 长度至少为 12 位');
  }
  if (configuredDemoPassword && !isPasswordWithinByteLimit(configuredDemoPassword)) throw new Error("DEMO_USER_PASSWORD 的 UTF-8 编码不能超过72字节");
  const seedPassword = configuredDemoPassword || crypto.randomBytes(24).toString('base64url');
  const ensureUser = (seedKey: string, username: string, avatar: string | null, bio: string) => {
    let u = db.prepare('SELECT id FROM users WHERE username = ? OR nickname = ?').get(username, seedKey) as { id: number } | undefined;
    if (!u) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(seedPassword, salt);
      const res = db.prepare(`
        INSERT INTO users (username, password_hash, nickname, avatar_url, bio, daily_calories_target)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(username, hash, seedKey, avatar, bio, 2100);
      return Number(res.lastInsertRowid);
    }
    // 本地测试可选择统一演示账号密码；未配置时不会改动已有凭据。
    if (configuredDemoPassword) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(configuredDemoPassword, salt);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, u.id);
    }
    return u.id;
  };

  const userId = ensureUser(
    'demo',
    '健康体验家',
    null,
    '追求自然原味与有氧健康生活的记录者。'
  );

  const u2 = ensureUser(
    'chef_david',
    '主厨David',
    null,
    '专注减脂餐与低温慢煮料理的主厨。'
  );

  const u3 = ensureUser(
    'family_kitchen',
    '元气烘焙日记',
    null,
    '分享无油无糖烘焙与家庭健康餐。'
  );

  const u4 = ensureUser(
    'nutritionist_lisa',
    '注册营养师Lisa',
    null,
    '临床营养学硕士，科普科学饮食知识。'
  );

  const u5 = ensureUser(
    'fitness_jack',
    '健身达人Jack',
    null,
    '力量训练与高蛋白增肌美食研究者。'
  );

  const u6 = ensureUser(
    'diet_helper',
    '减脂小助手',
    null,
    '每日推荐高性价比低卡美食与好物。'
  );

  seedDemoHealthProfiles({ userId, u2, u3, u4, u5, u6 });

  db.prepare(`
    UPDATE users
    SET avatar_url = NULL
    WHERE avatar_url IN (?, ?, ?, ?, ?, ?)
  `).run(
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80',
  );

  const adminUser = db.prepare(`
    SELECT id, password_hash, must_change_password
    FROM users
    WHERE username = ?
  `).get('admin') as
    | { id: number; password_hash: string; must_change_password: number }
    | undefined;
  if (!adminUser) {
    const configuredInitialPassword = process.env.ADMIN_INITIAL_PASSWORD?.trim();
    if (process.env.NODE_ENV === 'production' && (!configuredInitialPassword || configuredInitialPassword.length < 12)) {
      throw new Error('首次部署必须设置长度至少为 12 位的 ADMIN_INITIAL_PASSWORD');
    }

    if (configuredInitialPassword && !isPasswordWithinByteLimit(configuredInitialPassword)) throw new Error("ADMIN_INITIAL_PASSWORD 的 UTF-8 编码不能超过72字节");
    const bootstrapPassword = configuredInitialPassword || crypto.randomBytes(18).toString('base64url');
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(bootstrapPassword, salt);
    db.prepare(`
      INSERT INTO users (username, password_hash, nickname, avatar_url, bio, role, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run('admin', hash, '超级管理员', '', '系统管理员账号', 'admin');

    if (!configuredInitialPassword) {
      console.warn(`[Security] 开发环境管理员一次性初始密码：${bootstrapPassword}`);
    }
  } else {
    db.prepare(`UPDATE users SET role = 'admin' WHERE username = 'admin'`).run();
    if (bcrypt.compareSync('123456', adminUser.password_hash)) {
      db.prepare(`
        UPDATE users
        SET must_change_password = 1
        WHERE id = ?
      `).run(adminUser.id);
      console.warn('[Security] 检测到旧版默认管理员密码，已要求下次登录强制修改。');
    }
  }

  // Helper date function (YYYY-MM-DD)
  const getDateStr = (offsetDays: number) => dateKeyAfterDays(offsetDays);

  // 1. Seed Inventory Items if empty or sparse (< 8)
  const invCount = db.prepare('SELECT COUNT(*) as count FROM inventory_items WHERE user_id = ?').get(userId) as { count: number };
  if (invCount.count < 8) {
    db.prepare('DELETE FROM inventory_items WHERE user_id = ?').run(userId);

    const insertInventory = db.prepare(`
      INSERT INTO inventory_items (user_id, food_name, category, quantity, expiration_date, storage_location, image_url, is_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);

    // 蔬菜
    insertInventory.run(userId, '新鲜水培菠菜', '蔬菜', '300g', getDateStr(1), '冷藏', 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '减脂羽衣甘蓝', '蔬菜', '200g', getDateStr(3), '冷藏', 'https://images.unsplash.com/photo-1524179091875-bf0A49971D50?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '樱桃小番茄', '蔬菜', '1盒', getDateStr(4), '冷藏', 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '有机罗马生菜', '蔬菜', '200g', getDateStr(2), '冷藏', 'https://images.unsplash.com/photo-1622206151226-18ca2c9ab4a1?w=400&auto=format&fit=crop&q=80');

    // 肉食 / 海鲜
    insertInventory.run(userId, '谷物养殖鸡胸肉', '肉食', '500g', getDateStr(5), '冷冻', 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '挪威原切三文鱼排', '肉食', '300g', getDateStr(2), '冷冻', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '智利南美大虾仁', '肉食', '400g', getDateStr(12), '冷冻', 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=400&auto=format&fit=crop&q=80');

    // 水果
    insertInventory.run(userId, '高山水培牛油果', '水果', '3个', getDateStr(2), '冷藏', 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '智利新鲜大蓝莓', '水果', '2盒', getDateStr(3), '冷藏', 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '新疆阳光玫瑰葡萄', '水果', '500g', getDateStr(4), '冷藏', 'https://images.unsplash.com/photo-1537640538966-79f369143f8f?w=400&auto=format&fit=crop&q=80');

    // 乳制品
    insertInventory.run(userId, '低脂无糖希腊酸奶', '乳制品', '2盒', getDateStr(1), '冷藏', 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '优质无糖杏仁奶', '乳制品', '1L', getDateStr(10), '常温', 'https://images.unsplash.com/photo-1556761223-4c4282c73f77?w=400&auto=format&fit=crop&q=80');

    // 粮油干货
    insertInventory.run(userId, '三色有机藜麦', '粮油干货', '1包', getDateStr(60), '常温', 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&auto=format&fit=crop&q=80');
    insertInventory.run(userId, '特级初榨橄榄油', '粮油干货', '500ml', getDateStr(90), '常温', 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&auto=format&fit=crop&q=80');
  }

  // 体验账号的库存按名称增量补齐，展示更丰富的食材搭配；不会影响任何真实用户库存。
  const demoInventoryExists = db.prepare(
    'SELECT id FROM inventory_items WHERE user_id = ? AND food_name = ? LIMIT 1'
  );
  const insertDemoInventory = db.prepare(`
    INSERT INTO inventory_items (user_id, food_name, category, quantity, expiration_date, storage_location, is_available)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const demoInventory = [
    ['西兰花', '蔬菜', '1颗', 3, '冷藏'],
    ['彩椒', '蔬菜', '2个', 4, '冷藏'],
    ['鲜香菇', '蔬菜', '200g', 3, '冷藏'],
    ['北豆腐', '肉食', '1盒', 2, '冷藏'],
    ['金枪鱼罐头', '肉食', '2罐', 45, '常温'],
    ['无菌鸡蛋', '乳制品', '6个', 14, '冷藏'],
    ['全麦意面', '粮油干货', '1包', 120, '常温'],
    ['即食燕麦片', '粮油干货', '1袋', 120, '常温'],
  ] as const;
  for (const item of demoInventory) {
    if (!demoInventoryExists.get(userId, item[0])) {
      insertDemoInventory.run(userId, item[0], item[1], item[2], getDateStr(item[3]), item[4]);
    }
  }

  // 2. Seed Diet Records (Past 7 Days for full trends and date navigation)
  const dietCount = db.prepare('SELECT COUNT(*) as count FROM diet_records WHERE user_id = ?').get(userId) as { count: number };
  if (dietCount.count < 10) {
    db.prepare('DELETE FROM diet_records WHERE user_id = ?').run(userId);

    const insertDiet = db.prepare(`
      INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const defaultMealTimes: Record<string, string> = {
      早餐: "08:00",
      午餐: "12:30",
      晚餐: "18:30",
      加餐: "15:30",
    };

    // 7天日志模板数据
    const dailyDietTemplates = [
      // 今天 (d-0)
      [
        { meal: '早餐', name: '牛油果酸奶烘焙吐司', amount: '1份', cal: 380, p: 18, c: 42, f: 14, img: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=400&auto=format&fit=crop&q=80' },
        { meal: '午餐', name: '香煎鸡胸肉羽衣甘蓝沙拉', amount: '1盘', cal: 520, p: 46, c: 28, f: 16, img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&auto=format&fit=crop&q=80' },
        { meal: '晚餐', name: '挪威三文鱼藜麦暖碗', amount: '1碗', cal: 560, p: 38, c: 45, f: 22, img: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&auto=format&fit=crop&q=80' },
        { meal: '加餐', name: '混合坚果与无糖酸奶', amount: '1小碗', cal: 180, p: 8, c: 12, f: 10, img: 'https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=400&auto=format&fit=crop&q=80' }
      ],
      // 昨天 (d-1)
      [
        { meal: '早餐', name: '莓果燕麦希腊酸奶碗', amount: '1碗', cal: 320, p: 16, c: 45, f: 6, img: 'https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=400&auto=format&fit=crop&q=80' },
        { meal: '午餐', name: '水煮牛肉菠菜荞麦面', amount: '1大碗', cal: 580, p: 42, c: 55, f: 15, img: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&auto=format&fit=crop&q=80' },
        { meal: '晚餐', name: '彩椒基围虾能量大沙拉', amount: '1盘', cal: 410, p: 34, c: 25, f: 12, img: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&auto=format&fit=crop&q=80' }
      ],
      // 前天 (d-2)
      [
        { meal: '早餐', name: '美式咖啡与全麦金枪鱼三明治', amount: '1套', cal: 350, p: 22, c: 38, f: 9, img: 'https://images.unsplash.com/photo-1509722747041-616f39b57569?w=400&auto=format&fit=crop&q=80' },
        { meal: '午餐', name: '香烤紫薯鸡胸肉果蔬拼盘', amount: '1盘', cal: 510, p: 44, c: 48, f: 11, img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&auto=format&fit=crop&q=80' },
        { meal: '晚餐', name: '清蒸鲈鱼与温水煮菠菜', amount: '1份', cal: 430, p: 38, c: 15, f: 14, img: null }
      ],
      // d-3
      [
        { meal: '早餐', name: '水煮蛋2个与低脂鲜牛奶', amount: '1杯1碗', cal: 260, p: 20, c: 12, f: 12, img: null },
        { meal: '午餐', name: '黑胡椒牛柳彩谷香米饭', amount: '1份', cal: 620, p: 38, c: 68, f: 18, img: 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=400&auto=format&fit=crop&q=80' },
        { meal: '晚餐', name: '牛油果低脂大沙拉碗', amount: '1碗', cal: 390, p: 15, c: 30, f: 19, img: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&auto=format&fit=crop&q=80' }
      ],
      // d-4
      [
        { meal: '早餐', name: '全麦贝果配低脂软干酪', amount: '1个', cal: 340, p: 14, c: 46, f: 8, img: null },
        { meal: '午餐', name: '香煎三文鱼块配西兰花', amount: '1份', cal: 540, p: 36, c: 22, f: 24, img: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&auto=format&fit=crop&q=80' },
        { meal: '晚餐', name: '西红柿炖牛肉汤', amount: '1大碗', cal: 480, p: 40, c: 25, f: 16, img: null }
      ],
      // d-5
      [
        { meal: '早餐', name: '美式大早茶配水培生菜吐司', amount: '1份', cal: 370, p: 16, c: 40, f: 11, img: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=400&auto=format&fit=crop&q=80' },
        { meal: '午餐', name: '嫩滑香菇鸡胸肉排', amount: '1盘', cal: 490, p: 45, c: 30, f: 12, img: null },
        { meal: '晚餐', name: '南瓜浓汤与全麦面包片', amount: '1碗', cal: 360, p: 10, c: 55, f: 7, img: null }
      ],
      // d-6
      [
        { meal: '早餐', name: '蓝莓奇亚籽隔夜燕麦', amount: '1罐', cal: 310, p: 14, c: 42, f: 7, img: 'https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=400&auto=format&fit=crop&q=80' },
        { meal: '午餐', name: '黑椒鸡胸肉藜麦配菜碗', amount: '1盘', cal: 530, p: 43, c: 45, f: 14, img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&auto=format&fit=crop&q=80' },
        { meal: '晚餐', name: '白焯虾仁与清炒时菜', amount: '1盘', cal: 380, p: 32, c: 18, f: 10, img: null }
      ]
    ];

    dailyDietTemplates.forEach((dayItems, dayOffset) => {
      const dateStr = getDateStr(-dayOffset);
      dayItems.forEach(item => {
        insertDiet.run(userId, item.meal, item.name, item.amount, item.cal, item.p, item.c, item.f, dateStr, defaultMealTimes[item.meal] || null, item.img);
      });
    });
  }

  // 3. Seed Health Data (Past 14 Days for clear weight & body fat trend)
  const healthCount = db.prepare('SELECT COUNT(*) as count FROM health_logs WHERE user_id = ?').get(userId) as { count: number };
  if (healthCount.count < 7) {
    db.prepare('DELETE FROM health_logs WHERE user_id = ?').run(userId);

    const insertHealth = db.prepare(`
      INSERT INTO health_logs (user_id, weight, body_fat, water_ml, recorded_date)
      VALUES (?, ?, ?, ?, ?)
    `);

    // 14天模拟健康数据
    const healthHistory = [
      { offset: 0, weight: 62.5, fat: 18.4, water: 1650 },
      { offset: 1, weight: 62.7, fat: 18.5, water: 2100 },
      { offset: 2, weight: 62.9, fat: 18.6, water: 1900 },
      { offset: 3, weight: 63.1, fat: 18.7, water: 2200 },
      { offset: 4, weight: 63.4, fat: 18.9, water: 1800 },
      { offset: 5, weight: 63.6, fat: 19.0, water: 2000 },
      { offset: 6, weight: 63.8, fat: 19.1, water: 1750 },
      { offset: 7, weight: 64.0, fat: 19.3, water: 2050 },
      { offset: 8, weight: 64.2, fat: 19.5, water: 1950 },
      { offset: 9, weight: 64.5, fat: 19.6, water: 1800 },
      { offset: 10, weight: 64.7, fat: 19.8, water: 2100 },
      { offset: 11, weight: 65.0, fat: 20.0, water: 1700 },
      { offset: 12, weight: 65.2, fat: 20.1, water: 1900 },
      { offset: 13, weight: 65.4, fat: 20.3, water: 1850 }
    ];

    healthHistory.forEach(h => {
      insertHealth.run(userId, h.weight, h.fat, h.water, getDateStr(-h.offset));
    });
  }

  // 4. Seed Recipes (Enriched to 8 detailed recipes)
  const recipeCount = db.prepare('SELECT COUNT(*) as count FROM recipes').get() as { count: number };
  if (recipeCount.count < 8) {
    db.prepare('DELETE FROM recipes').run();
    const insertRecipe = db.prepare(`
      INSERT INTO recipes (title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRecipe.run(
      '牛油果高纤蛋白烘焙碗',
      '浓郁滑顺的牛油果搭配高蛋白烤鸡胸与水煮青豆，低碳水极速提神。',
      'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&auto=format&fit=crop&q=80',
      15,
      '简单',
      420,
      32,
      24,
      18,
      '减脂',
      JSON.stringify(['低碳水', '高蛋白', '快手菜']),
      JSON.stringify([
        '切开成熟牛油果压成泥，挤入少许柠檬汁。',
        '鸡胸肉用少许海盐、黑胡椒轻腌后煎至两面金黄。',
        '将菠菜垫底，摆上鸡胸肉、牛油果泥与青豆即可享用。'
      ]),
      JSON.stringify(['牛油果 1个', '鸡胸肉 150g', '水培菠菜 80g', '柠檬 半个', '海盐与黑胡椒 适量'])
    );

    insertRecipe.run(
      '香煎三文鱼藜麦暖碗',
      '富含 Omega-3 的优质深海三文鱼，搭配高纤维藜麦与烤南瓜，温暖饱腹。',
      'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&auto=format&fit=crop&q=80',
      25,
      '中等',
      530,
      38,
      45,
      22,
      '增肌',
      JSON.stringify(['高能量', '优质脂肪', '有氧复原']),
      JSON.stringify([
        '藜麦洗净后按 1:2 水量煮熟备用。',
        '三文鱼皮朝下煎至酥脆，随后翻面煎至8分熟。',
        '烤箱 200 度将南瓜块烘烤 15 分钟。',
        '组合装盘，淋上橄榄油和油醋汁。'
      ]),
      JSON.stringify(['挪威三文鱼 180g', '三色藜麦 60g', '贝贝南瓜 100g', '特级初榨橄榄油 10ml'])
    );

    insertRecipe.run(
      '莓果希腊酸奶隔夜燕麦',
      '不需要开火的高颜值极速早餐，富含活性益生菌与膳食纤维。',
      'https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=600&auto=format&fit=crop&q=80',
      5,
      '极简',
      290,
      16,
      38,
      6,
      '营养餐单',
      JSON.stringify(['无油烟', '隔夜准备', '肠道健康']),
      JSON.stringify([
        '密封罐中放入燕麦片、无糖酸奶与无糖杏仁奶搅拌均匀。',
        '盖紧盖子放入冰箱冷藏保存过夜（至少6小时）。',
        '次日清晨铺上新鲜蓝莓、草莓与少许坚果碎即可。'
      ]),
      JSON.stringify(['快熟燕麦片 40g', '希腊酸奶 120g', '新鲜蓝莓 30g', '杏仁奶 100ml'])
    );

    insertRecipe.run(
      '低卡嫩滑香菇鸡胸肉排',
      '鲜香多汁的高蛋白家常菜，低脂低热量，健身党最爱的硬核主菜。',
      'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=600&auto=format&fit=crop&q=80',
      18,
      '简单',
      360,
      44,
      12,
      10,
      '快手菜',
      JSON.stringify(['低卡', '硬核增肌', '快手菜']),
      JSON.stringify([
        '鸡胸肉用刀背拍松，加入生抽、少许淀粉和胡椒粉腌制10分钟。',
        '香菇洗净切厚片，热锅下少量橄榄油将香菇炒香。',
        '放入鸡胸肉排两面小火慢煎，淋上少许水淀粉盖盖焖煮3分钟至熟透。'
      ]),
      JSON.stringify(['鸡胸肉 200g', '鲜香菇 5朵', '生抽 10ml', '黑胡椒粉 2g', '橄榄油 5ml'])
    );

    insertRecipe.run(
      '阳光彩椒基围虾能量沙拉',
      '鲜甜饱满的甜虾搭配五彩彩椒与罗马生菜，清爽爽口无负担。',
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80',
      12,
      '极简',
      310,
      32,
      18,
      9,
      '减脂',
      JSON.stringify(['低热量', '高膳食纤维', '清爽']),
      JSON.stringify([
        '鲜虾去壳去虾线，沸水下锅加姜片烫熟。',
        '彩椒切小丁，罗马生菜洗净撕成适口小块。',
        '将所有食材混合，淋上油醋汁与一勺黑胡椒拌匀。'
      ]),
      JSON.stringify(['基围虾仁 150g', '红黄彩椒 各半个', '罗马生菜 100g', '特级油醋汁 15ml'])
    );

    insertRecipe.run(
      '黑胡椒牛柳炒彩谷香米饭',
      '经典黑胡椒风味大口吃肉炒饭，优质复合碳水与牛肉蛋白质的双重碰撞。',
      'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=600&auto=format&fit=crop&q=80',
      20,
      '中等',
      580,
      36,
      62,
      16,
      '增肌',
      JSON.stringify(['高蛋白质', '能量补充', '风味佳']),
      JSON.stringify([
        '精选牛柳切小块，用酱油与少许黑胡椒酱腌制。',
        '热锅下橄榄油炒香洋葱丝，倒入牛柳大火翻炒至变色。',
        '倒入煮熟的糙米彩谷饭，加入青豆粒迅速翻炒均匀出锅。'
      ]),
      JSON.stringify(['精选牛柳 150g', '糙米彩谷饭 150g', '洋葱 半个', '黑胡椒酱 15g'])
    );

    insertRecipe.run(
      '羽衣甘蓝青苹果抗氧羽蔬汁',
      '富含维生素C与矿物质的低糖绿汁，早晨饮用唤醒清爽代谢力。',
      'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=600&auto=format&fit=crop&q=80',
      5,
      '极简',
      160,
      4,
      32,
      1,
      '营养餐单',
      JSON.stringify(['抗氧化', '排毒提神', '无糖']),
      JSON.stringify([
        '羽衣甘蓝洗净去硬梗，青苹果去核切小块。',
        '将羽衣甘蓝、青苹果块与纯净水倒入破壁机。',
        '高速搅打40秒至细腻无颗粒感，即打即饮。'
      ]),
      JSON.stringify(['羽衣甘蓝 60g', '青苹果 1个', '柠檬汁 5ml', '纯净水 200ml'])
    );

    insertRecipe.run(
      '空气炸锅金枪鱼全麦帕尼尼',
      '外酥里嫩的金枪鱼奶酪吐司，10分钟快手搞定高颜值早餐。',
      'https://images.unsplash.com/photo-1509722747041-616f39b57569?w=600&auto=format&fit=crop&q=80',
      10,
      '简单',
      340,
      26,
      36,
      9,
      '快手菜',
      JSON.stringify(['空气炸锅', '快手早餐', '低脂']),
      JSON.stringify([
        '水浸金枪鱼沥干水分，加入少许低脂酸奶与黑胡椒拌匀。',
        '铺在全麦吐司片上，撒上一层马苏里拉奶酪碎，盖上另一片吐司。',
        '放入空气炸锅 180 度烘烤 6 分钟至表面酥脆切半。'
      ]),
      JSON.stringify(['全麦吐司 2片', '水浸金枪鱼罐头 80g', '低脂马苏里拉奶酪 20g', '黑胡椒 1g'])
    );
  }

  // 5. Seed Community Posts (Enriched to 32 diverse posts across 4 tabs)
  const postCount = db.prepare('SELECT COUNT(*) as count FROM community_posts').get() as { count: number };
  if (postCount.count < 32) {
    db.prepare('DELETE FROM community_posts').run();
    const insertPost = db.prepare(`
      INSERT INTO community_posts (user_id, username, nickname, avatar_url, category, content, image_url, likes_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const avatar1 = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80';
    const avatar2 = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80';
    const avatar3 = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80';
    const avatar4 = 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80';
    const avatar5 = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80';
    const avatar6 = 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80';

    // === 寻味 (Recipes & Dishes) ===
    insertPost.run(
      userId, 'demo', '绿色食物分享家', avatar1, '寻味',
      '绿色食物推荐：用新鲜黄瓜、胡萝卜、西兰花与红甘蓝搭配特级橄榄油，解锁满满膳食纤维与活力能量！',
      'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80', 1000
    );
    insertPost.run(
      u2, 'chef_david', '主厨David', avatar2, '寻味',
      '健康早餐场景：全麦吐司配切片牛油果，太阳蛋搭配新鲜切块番茄，开启仪式感拉满的一天。',
      'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format&fit=crop&q=80', 10000
    );
    insertPost.run(
      u3, 'family_kitchen', '元气烘焙日记', avatar3, '寻味',
      '厨房食材储存系统：用分装玻璃罐将五谷杂粮与干货分类归纳，保持厨房整洁与食材新鲜。',
      'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop&q=80', 5300
    );
    insertPost.run(
      u2, 'chef_david', '主厨David', avatar2, '寻味',
      '三文鱼藜麦极简减脂餐：高温煎香鱼皮，油脂自然渗入藜麦，简单黑胡椒调味就足够惊艳！',
      'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=800&auto=format&fit=crop&q=80', 3200
    );
    insertPost.run(
      u3, 'family_kitchen', '元气烘焙日记', avatar3, '寻味',
      '蓝莓奇亚籽高蛋白奶昔杯：冷藏后呈现啫喱般丝滑口感，抗氧化因子爆棚，夏日解暑神仙加餐！',
      'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=800&auto=format&fit=crop&q=80', 4800
    );
    insertPost.run(
      u2, 'chef_david', '主厨David', avatar2, '寻味',
      '烤虾仁菠菜藜麦能量碗：高蛋白、低碳水，色泽鲜亮诱人，夏天吃清爽无负担。',
      'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format&fit=crop&q=80', 6200
    );
    insertPost.run(
      u5, 'fitness_jack', '健身达人Jack', avatar5, '寻味',
      '慢炖香草番茄鸡胸肉：摒弃柴柴的口感，锁住肉汁，配一小碗黑米饭堪称神仙组合！',
      'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=800&auto=format&fit=crop&q=80', 3900
    );
    insertPost.run(
      userId, 'demo', '绿色食物分享家', avatar1, '寻味',
      '抹茶羽衣甘蓝低卡拿铁：用燕麦奶代替全脂奶，加入少许代糖，下午茶的健康新选择。',
      'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=800&auto=format&fit=crop&q=80', 7100
    );

    // === 榜单 (Rankings & Charts) ===
    insertPost.run(
      userId, 'demo', '绿色食物分享家', avatar1, '榜单',
      '🏆 2026年度社区【低卡减脂餐热度榜 TOP 1】：羽衣甘蓝鸡胸肉低脂沙拉，点赞突破 1.2w！',
      'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop&q=80', 12800
    );
    insertPost.run(
      u2, 'chef_david', '主厨David', avatar2, '榜单',
      '🥇 优质高蛋白食材星级榜：三文鱼、虾仁、牛腱子肉、无糖希腊酸奶对比图鉴与烹饪建议。',
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&auto=format&fit=crop&q=80', 9500
    );
    insertPost.run(
      u3, 'family_kitchen', '元气烘焙日记', avatar3, '榜单',
      '🌟 社区热议厨房神器红榜：分装密封玻璃罐推荐，干货防潮整理，收纳美学极致体验！',
      'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop&q=80', 7400
    );
    insertPost.run(
      u4, 'nutritionist_lisa', '注册营养师Lisa', avatar4, '榜单',
      '📊 本周食友评选【最受好评减脂早餐吃法】，全麦牛油果水煮蛋吐司高票夺冠！',
      'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format&fit=crop&q=80', 8800
    );
    insertPost.run(
      u6, 'diet_helper', '减脂小助手', avatar6, '榜单',
      '🏆 2026年【办公室打工人冷餐便当红榜】：方便携带、不易变质的 5 款低卡餐推荐。',
      'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format&fit=crop&q=80', 11200
    );
    insertPost.run(
      u4, 'nutritionist_lisa', '注册营养师Lisa', avatar4, '榜单',
      '🥑 全球最适合减脂期使用的【优质植物油脂星级榜】：特级初榨橄榄油、亚麻籽油、牛油果油评测。',
      'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&auto=format&fit=crop&q=80', 8900
    );
    insertPost.run(
      u2, 'chef_david', '主厨David', avatar2, '榜单',
      '🥇 社区选出【低碳水替代主食排行榜】：魔芋面、花菜米、西葫芦丝、黑米藜麦饭排名公开！',
      'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=80', 10400
    );
    insertPost.run(
      userId, 'demo', '绿色食物分享家', avatar1, '榜单',
      '📊 减脂期最受追捧的 4 款【无糖低卡小零食】：冻干无花果、高蛋白黑巧、无盐坚果组合。',
      'https://images.unsplash.com/photo-1608219992759-8d74ed8d76eb?w=800&auto=format&fit=crop&q=80', 6700
    );

    // === 活动 (Events & Challenges) ===
    insertPost.run(
      u3, 'family_kitchen', '元气烘焙日记', avatar3, '活动',
      '🥊 #7天减脂餐打卡挑战# 第21天：精准搭配蛋白质、碳水与微量元素，今天体脂率又下降了0.3%！',
      'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop&q=80', 8600
    );
    insertPost.run(
      userId, 'demo', '绿色食物分享家', avatar1, '活动',
      '🎉 #周末低卡烘焙大赛# 正式开启！分享你的低糖无面粉烘焙食谱，赢取精美厨具礼盒！',
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80', 6700
    );
    insertPost.run(
      u2, 'chef_david', '主厨David', avatar2, '活动',
      '🏃‍♂️ #无糖饮食7天挑战赛# 超过 3,200 位食友在线参与，一起来戒糖换发神采！',
      'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=80', 5200
    );
    insertPost.run(
      u4, 'nutritionist_lisa', '注册营养师Lisa', avatar4, '活动',
      '📸 #晒晒你的减脂餐桌# 摄影打卡活动热辣进行中，发布照片即送社区专属勋章与营养评估指导！',
      'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format&fit=crop&q=80', 4100
    );
    insertPost.run(
      u4, 'nutritionist_lisa', '注册营养师Lisa', avatar4, '活动',
      '💧 #21天每天喝水2000ml打卡# 挑战第三周！皮肤变透亮，基础代谢显著提升！',
      'https://images.unsplash.com/photo-1548839140-29a749e1cf4e?w=800&auto=format&fit=crop&q=80', 7800
    );
    insertPost.run(
      u6, 'diet_helper', '减脂小助手', avatar6, '活动',
      '🍱 #自带减脂便当去上班# 话题大奖赛！连续打卡 5 天即可抽取无油空气炸锅！',
      'https://images.unsplash.com/photo-1511690656952-34342bb7c2f2?w=800&auto=format&fit=crop&q=80', 9100
    );
    insertPost.run(
      u5, 'fitness_jack', '健身达人Jack', avatar5, '活动',
      '🧘‍♀️ #早起空腹拉伸+低糖早餐计划# 已有 5,600 人加入，每天 10 分钟告别水肿！',
      'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&auto=format&fit=crop&q=80', 8300
    );
    insertPost.run(
      u3, 'family_kitchen', '元气烘焙日记', avatar3, '活动',
      '🥗 #低卡沙拉酱盲测大赛# 你最爱哪款酱汁？快来分享你的低脂油醋汁私房调配比例！',
      'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop&q=80', 5900
    );

    // === 问答 (Q&A & Knowledge) ===
    insertPost.run(
      u4, 'nutritionist_lisa', '注册营养师Lisa', avatar4, '问答',
      '【营养科普】为什么减脂期推荐优先选择希腊酸奶而非普通风味酸奶？看这三点蛋白质与糖分对比就明白了！',
      'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&auto=format&fit=crop&q=80', 6400
    );
    insertPost.run(
      u2, 'chef_david', '主厨David', avatar2, '问答',
      '💡 【食友提问】减脂期晚上饿了吃什么不会胖？营养师为你推荐3款低热量加餐食物！',
      'https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=800&auto=format&fit=crop&q=80', 4900
    );
    insertPost.run(
      userId, 'demo', '绿色食物分享家', avatar1, '问答',
      '🥑 【食材大解密】牛油果虽然健康但油脂高，一天吃半个还是一整颗合适？权威解读来了！',
      'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format&fit=crop&q=80', 5800
    );
    insertPost.run(
      u3, 'family_kitchen', '元气烘焙日记', avatar3, '问答',
      '🍳 【烹饪小贴士】橄榄油、椰子油和黄油，不同烹饪温度下该怎么挑选？避坑实用指南。',
      'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&auto=format&fit=crop&q=80', 3600
    );
    insertPost.run(
      u4, 'nutritionist_lisa', '注册营养师Lisa', avatar4, '问答',
      '❓ 【营养问答】为什么吃同样热量的米饭和牛肉，牛肉更不容易饿？带你了解食物热效应（TEF）。',
      'https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop&q=80', 7300
    );
    insertPost.run(
      u6, 'diet_helper', '减脂小助手', avatar6, '问答',
      '🥑 【避坑指南】减脂期如何正确计算食材热量？生重 vs 熟重到底怎么区分？',
      'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&auto=format&fit=crop&q=80', 8500
    );
    insertPost.run(
      u3, 'family_kitchen', '元气烘焙日记', avatar3, '问答',
      '🍞 【食友求助】全麦面包成分表第一位必须是全麦粉吗？怎么识别假全麦？',
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80', 6100
    );
    insertPost.run(
      u2, 'chef_david', '主厨David', avatar2, '问答',
      '🍳 【食谱答疑】空气炸锅烤鸡胸肉怎样做到外酥里嫩、不柴不干？三大关键步骤公开。',
      'https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=800&auto=format&fit=crop&q=80', 9400
    );
  }
}

type DemoHealthProfile = {
  userId: number;
  loginEmail: string;
  dailyCaloriesTarget: number;
  gender: string;
  age: number;
  height: number;
  weight: number;
  targetWeight: number;
  healthGoal: string;
  activityLevel: string;
  dietaryPreference: string;
  allergies: Array<{ name: string; type: 'allergy' | 'intolerance'; severity: 'mild' | 'moderate' | 'severe' }>;
  medications: string;
  medicalConditions: string[];
  medicalNotes: string;
  dietaryRestrictions: string[];
  dislikedFoods: string;
  kitchenConstraints: Record<string, string | number>;
  nutritionTargets: Record<string, string | number>;
  latestHealth: {
    bodyFat?: number;
    waterMl: number;
    restingHeartRate: number;
    bloodPressureSystolic?: number;
    bloodPressureDiastolic?: number;
    bloodGlucoseMmol?: number;
    cycleStatus?: string;
    sleepHours: number;
  };
};

/**
 * 每个演示账号对应一类可重复的 AI / 推荐算法测试场景。
 * 只在 ENABLE_DEMO_SEED=1 时执行，以 seed key 锁定演示用户，不会扫描或更新真实账号。
 */
function seedDemoHealthProfiles(ids: { userId: number; u2: number; u3: number; u4: number; u5: number; u6: number }) {
  const profiles: DemoHealthProfile[] = [
    {
      userId: ids.userId, loginEmail: 'demo@dietdigidose.test', dailyCaloriesTarget: 1650, gender: '女', age: 29, height: 165, weight: 62.5, targetWeight: 58,
      healthGoal: 'lose_weight', activityLevel: 'moderate', dietaryPreference: '高蛋白、家常中餐',
      allergies: [{ name: '坚果', type: 'allergy', severity: 'severe' }, { name: '乳糖', type: 'intolerance', severity: 'moderate' }],
      medications: '', medicalConditions: [], medicalNotes: '重度坚果过敏，需要同时考虑交叉污染风险。',
      dietaryRestrictions: ['无坚果', '低乳糖'], dislikedFoods: '香菜、芹菜',
      kitchenConstraints: { meal_time_minutes: 20, budget_per_meal: 35, cooking_level: 'beginner', servings: 1, eating_out_frequency: 'sometimes' },
      nutritionTargets: { calories_kcal: 1650, protein_g: 95, sugar_g: 30, water_ml: 2000, professional_advice: '严格回避坚果及可能的交叉污染。' },
      latestHealth: { bodyFat: 27.2, waterMl: 1650, restingHeartRate: 68, sleepHours: 6.5 },
    },
    {
      userId: ids.u2, loginEmail: 'chef-david@dietdigidose.test', dailyCaloriesTarget: 1900, gender: '男', age: 46, height: 175, weight: 82, targetWeight: 76,
      healthGoal: 'reduce_fat', activityLevel: 'light', dietaryPreference: '地中海式、少油', allergies: [],
      medications: '二甲双胍、氯沙坦（请按医嘱，测试数据）', medicalConditions: ['2 型糖尿病', '高血压'],
      medicalNotes: '需保守处理控糖、控钠与用药相互作用提醒，不应调整药物。', dietaryRestrictions: ['低盐', '限添加糖'],
      dislikedFoods: '肥肉、甜饮料', kitchenConstraints: { meal_time_minutes: 45, budget_per_meal: 60, cooking_level: 'advanced', servings: 2, eating_out_frequency: 'often' },
      nutritionTargets: { calories_kcal: 1900, protein_g: 100, salt_g: 5, sugar_g: 25, water_ml: 2000, professional_advice: '遵循医生和注册营养师制定的控糖、限钠方案。' },
      latestHealth: { bodyFat: 28.1, waterMl: 1800, restingHeartRate: 76, bloodPressureSystolic: 142, bloodPressureDiastolic: 91, bloodGlucoseMmol: 8.2, sleepHours: 6 },
    },
    {
      userId: ids.u3, loginEmail: 'family-kitchen@dietdigidose.test', dailyCaloriesTarget: 2200, gender: '女', age: 32, height: 163, weight: 59, targetWeight: 61,
      healthGoal: 'healthy', activityLevel: 'light', dietaryPreference: '蛋奶素食、家庭共餐',
      allergies: [{ name: '花生', type: 'allergy', severity: 'severe' }], medications: '孕期复合维生素（测试数据）',
      medicalConditions: ['孕期'], medicalNotes: '孕 24 周，仅用于测试孕期食品安全、能量与交叉污染提醒。',
      dietaryRestrictions: ['无花生', '不食生食', '避免未巴氏杀菌乳制品'], dislikedFoods: '生鱼片、动物内脏',
      kitchenConstraints: { meal_time_minutes: 40, budget_per_meal: 50, cooking_level: 'intermediate', servings: 3, eating_out_frequency: 'rarely' },
      nutritionTargets: { calories_kcal: 2200, protein_g: 80, water_ml: 2300, professional_advice: '按产检医生建议安排饮食，确保食物彻底熟制。' },
      latestHealth: { waterMl: 2100, restingHeartRate: 82, cycleStatus: '孕期', sleepHours: 7 },
    },
    {
      userId: ids.u4, loginEmail: 'nutritionist-lisa@dietdigidose.test', dailyCaloriesTarget: 1800, gender: '女', age: 38, height: 168, weight: 60, targetWeight: 60,
      healthGoal: 'maintain', activityLevel: 'active', dietaryPreference: '严格素食、高纤维',
      allergies: [{ name: '大豆', type: 'intolerance', severity: 'moderate' }], medications: '', medicalConditions: ['缺铁性贫血'],
      medicalNotes: '素食且大豆不耐受，用于测试蛋白质替代、铁摄入与冲突约束。', dietaryRestrictions: ['不食肉蛋奶', '无大豆'],
      dislikedFoods: '苦瓜', kitchenConstraints: { meal_time_minutes: 30, budget_per_meal: 45, cooking_level: 'advanced', servings: 1, eating_out_frequency: 'sometimes' },
      nutritionTargets: { calories_kcal: 1800, protein_g: 75, water_ml: 2000, professional_advice: '定期复查铁指标，蛋白质优先从非大豆素食来源组合。' },
      latestHealth: { bodyFat: 23.5, waterMl: 1900, restingHeartRate: 61, sleepHours: 7.5 },
    },
    {
      userId: ids.u5, loginEmail: 'fitness-jack@dietdigidose.test', dailyCaloriesTarget: 2850, gender: '男', age: 27, height: 183, weight: 78, targetWeight: 84,
      healthGoal: 'gain_muscle', activityLevel: 'very_active', dietaryPreference: '高蛋白、高碳水训练餐',
      allergies: [{ name: '乳糖', type: 'intolerance', severity: 'moderate' }], medications: '', medicalConditions: ['高尿酸血症'],
      medicalNotes: '增肌与高尿酸约束并存，不应为追求蛋白质而忽略风险。', dietaryRestrictions: ['低乳糖', '限高嘌呤食物'],
      dislikedFoods: '鸡胸肉', kitchenConstraints: { meal_time_minutes: 25, budget_per_meal: 55, cooking_level: 'intermediate', servings: 1, eating_out_frequency: 'sometimes' },
      nutritionTargets: { calories_kcal: 2850, protein_g: 150, sugar_g: 45, water_ml: 3000, professional_advice: '增肌期仍需按医生建议管理尿酸，不使用高嘌呤食物堆高蛋白质。' },
      latestHealth: { bodyFat: 14.8, waterMl: 2800, restingHeartRate: 55, sleepHours: 7.8 },
    },
    {
      userId: ids.u6, loginEmail: 'diet-helper@dietdigidose.test', dailyCaloriesTarget: 1550, gender: '女', age: 68, height: 158, weight: 66, targetWeight: 63,
      healthGoal: 'healthy', activityLevel: 'sedentary', dietaryPreference: '软烂家常菜、少量多餐',
      allergies: [{ name: '海鲜', type: 'allergy', severity: 'severe' }], medications: '华法林（测试数据，不得给出调药建议）',
      medicalConditions: ['慢性肾脏病', '房颤'], medicalNotes: '需同时检查海鲜过敏、肾脏病食事约束与药食相互作用，任何具体限制以专业意见为准。',
      dietaryRestrictions: ['低盐', '无海鲜', '软食'], dislikedFoods: '辣椒、坚硬食物',
      kitchenConstraints: { meal_time_minutes: 30, budget_per_meal: 30, cooking_level: 'beginner', servings: 1, eating_out_frequency: 'rarely' },
      nutritionTargets: { calories_kcal: 1550, protein_g: 55, salt_g: 4, water_ml: 1500, professional_advice: '蛋白质、钾、磷和饮水量均以肾科医生或营养师的个体化意见为准。' },
      latestHealth: { waterMl: 1350, restingHeartRate: 79, bloodPressureSystolic: 136, bloodPressureDiastolic: 84, sleepHours: 6.8 },
    },
  ];

  const upsertProfile = db.prepare(`
    INSERT INTO user_health_profiles (
      user_id, gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference,
      allergies_json, medications, medical_conditions_json, medical_notes, dietary_restrictions_json,
      disliked_foods, kitchen_constraints_json, nutrition_targets_json, tracking_enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      gender = excluded.gender, age = excluded.age, height = excluded.height, weight = excluded.weight,
      target_weight = excluded.target_weight, health_goal = excluded.health_goal, activity_level = excluded.activity_level,
      dietary_preference = excluded.dietary_preference, allergies_json = excluded.allergies_json,
      medications = excluded.medications, medical_conditions_json = excluded.medical_conditions_json,
      medical_notes = excluded.medical_notes, dietary_restrictions_json = excluded.dietary_restrictions_json,
      disliked_foods = excluded.disliked_foods, kitchen_constraints_json = excluded.kitchen_constraints_json,
      nutrition_targets_json = excluded.nutrition_targets_json, tracking_enabled = 1, updated_at = CURRENT_TIMESTAMP
  `);
  const deleteTodayHealth = db.prepare('DELETE FROM health_logs WHERE user_id = ? AND recorded_date = ?');
  const insertLatestHealth = db.prepare(`
    INSERT INTO health_logs (
      user_id, weight, body_fat, water_ml, height_cm, resting_heart_rate,
      blood_pressure_systolic, blood_pressure_diastolic, blood_glucose_mmol,
      cycle_status, sleep_hours, recorded_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateDemoUser = db.prepare('UPDATE users SET email = ?, phone = NULL, daily_calories_target = ? WHERE id = ?');
  const today = dateKeyAfterDays(0);

  db.transaction(() => {
    for (const profile of profiles) {
      upsertProfile.run(
        profile.userId, profile.gender, profile.age, profile.height, profile.weight, profile.targetWeight,
        profile.healthGoal, profile.activityLevel, profile.dietaryPreference, JSON.stringify(profile.allergies),
        profile.medications, JSON.stringify(profile.medicalConditions), profile.medicalNotes,
        JSON.stringify(profile.dietaryRestrictions), profile.dislikedFoods, JSON.stringify(profile.kitchenConstraints),
        JSON.stringify(profile.nutritionTargets),
      );
      updateDemoUser.run(profile.loginEmail, profile.dailyCaloriesTarget, profile.userId);
      deleteTodayHealth.run(profile.userId, today);
      insertLatestHealth.run(
        profile.userId, profile.weight, profile.latestHealth.bodyFat ?? null, profile.latestHealth.waterMl,
        profile.height, profile.latestHealth.restingHeartRate, profile.latestHealth.bloodPressureSystolic ?? null,
        profile.latestHealth.bloodPressureDiastolic ?? null, profile.latestHealth.bloodGlucoseMmol ?? null,
        profile.latestHealth.cycleStatus ?? null, profile.latestHealth.sleepHours, today,
      );
    }
  })();
}
