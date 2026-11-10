import { dateKeyAfterDays } from "./date";

export type StorageLocation = "冷藏" | "冷冻" | "常温";

export interface CommonIngredient {
  name: string;
  category: string;
  storageLocation: StorageLocation;
  shelfLifeDays: number;
  defaultQuantity: string;
  icon?: string;
}

export const COMMON_INGREDIENTS: CommonIngredient[] = [
  { name: "鸡蛋", category: "乳制品", storageLocation: "冷藏", shelfLifeDays: 30, defaultQuantity: "10个", icon: "egg" },
  { name: "牛奶", category: "乳制品", storageLocation: "冷藏", shelfLifeDays: 7, defaultQuantity: "1盒", icon: "glass-water" },
  { name: "酸奶", category: "乳制品", storageLocation: "冷藏", shelfLifeDays: 14, defaultQuantity: "1瓶", icon: "glass-water" },
  { name: "猪肉", category: "肉食", storageLocation: "冷藏", shelfLifeDays: 3, defaultQuantity: "500g", icon: "drumstick-bite" },
  { name: "鸡胸肉", category: "肉食", storageLocation: "冷藏", shelfLifeDays: 3, defaultQuantity: "500g", icon: "drumstick-bite" },
  { name: "牛肉", category: "肉食", storageLocation: "冷藏", shelfLifeDays: 3, defaultQuantity: "500g", icon: "drumstick-bite" },
  { name: "排骨", category: "肉食", storageLocation: "冷藏", shelfLifeDays: 3, defaultQuantity: "500g", icon: "drumstick-bite" },
  { name: "西红柿", category: "蔬菜", storageLocation: "常温", shelfLifeDays: 7, defaultQuantity: "3个", icon: "apple-whole" },
  { name: "黄瓜", category: "蔬菜", storageLocation: "冷藏", shelfLifeDays: 5, defaultQuantity: "2根", icon: "carrot" },
  { name: "土豆", category: "蔬菜", storageLocation: "常温", shelfLifeDays: 14, defaultQuantity: "3个", icon: "carrot" },
  { name: "胡萝卜", category: "蔬菜", storageLocation: "冷藏", shelfLifeDays: 14, defaultQuantity: "2根", icon: "carrot" },
  { name: "青菜", category: "蔬菜", storageLocation: "冷藏", shelfLifeDays: 4, defaultQuantity: "1把", icon: "seedling" },
  { name: "西兰花", category: "蔬菜", storageLocation: "冷藏", shelfLifeDays: 5, defaultQuantity: "1颗", icon: "seedling" },
  { name: "豆腐", category: "蔬菜", storageLocation: "冷藏", shelfLifeDays: 3, defaultQuantity: "1块", icon: "cubes" },
  { name: "苹果", category: "水果", storageLocation: "常温", shelfLifeDays: 14, defaultQuantity: "4个", icon: "apple-whole" },
  { name: "香蕉", category: "水果", storageLocation: "常温", shelfLifeDays: 5, defaultQuantity: "1串", icon: "apple-whole" },
  { name: "橙子", category: "水果", storageLocation: "常温", shelfLifeDays: 14, defaultQuantity: "4个", icon: "apple-whole" },
  { name: "大米", category: "粮油干货", storageLocation: "常温", shelfLifeDays: 180, defaultQuantity: "5kg", icon: "wheat-awn" },
  { name: "面粉", category: "粮油干货", storageLocation: "常温", shelfLifeDays: 180, defaultQuantity: "1kg", icon: "wheat-awn" },
  { name: "食用油", category: "调味品", storageLocation: "常温", shelfLifeDays: 365, defaultQuantity: "1瓶", icon: "bottle-droplet" },
  { name: "酱油", category: "调味品", storageLocation: "常温", shelfLifeDays: 180, defaultQuantity: "1瓶", icon: "bottle-droplet" },
  { name: "虾仁", category: "水产海鲜", storageLocation: "冷冻", shelfLifeDays: 90, defaultQuantity: "300g", icon: "fish" },
  { name: "鱼肉", category: "水产海鲜", storageLocation: "冷冻", shelfLifeDays: 60, defaultQuantity: "1条", icon: "fish" },
];

export interface IngredientDefaults {
  category: string;
  storageLocation: StorageLocation;
  shelfLifeDays: number;
  expirationDate: string;
  defaultQuantity: string;
}

export function inferCategoryByName(name: string): string {
  const trimmed = name.trim();
  const contains = (words: string[]) => words.some((word) => trimmed.includes(word));
  if (contains(["馒头", "包子", "饺子", "水饺", "馄饨", "汤圆", "烧卖", "花卷"])) return "熟食面点";
  if (contains(["奶", "芝士", "黄油", "蛋"])) return "乳制品";
  if (contains(["虾", "蟹", "贝", "鱼", "鱿", "海参", "生蚝", "蛤蜊", "紫菜", "海带", "水产"])) return "水产海鲜";
  if (contains(["猪", "鸡", "羊", "鸭", "鹅", "肉", "排骨", "培根", "火腿", "腊肉", "肉丸", "粉肠", "翅", "爪", "骨", "牛肉"])) return "肉食";
  if (contains(["苹果", "香蕉", "橙", "柚", "梨", "桃", "葡萄", "草莓", "蓝莓", "西瓜", "芒果", "猕猴桃", "樱桃", "柠檬", "甜瓜", "哈密瓜", "柿子", "荔枝", "龙眼", "无花果"])) return "水果";
  if (contains(["酱油", "醋", "盐", "糖", "耗油", "蚝油", "料酒", "味精", "鸡精", "胡椒", "花椒", "辣椒酱", "咖喱", "芝麻酱", "香油"])) return "调味品";
  if (contains(["面包", "蛋糕", "饼干", "薯片", "坚果", "巧克力", "糖果", "零食"])) return "休闲零食";
  if (contains(["米", "面", "粉", "豆", "燕麦", "罐头", "披萨", "挂面", "意面", "木耳", "香菇", "银耳"])) return "粮油干货";
  return "蔬菜";
}

export function inferShelfLifeDays(name: string, location: StorageLocation): number {
  if (location === "冷冻") {
    if (["肉", "骨", "排", "翅", "爪", "鱼", "虾", "蟹", "贝"].some((word) => name.includes(word))) return 180;
    if (/饺子|包子|汤圆|面点/i.test(name)) return 90;
    return 90;
  }

  const category = inferCategoryByName(name);

  if (location === "常温") {
    if (category === "调味品" || category === "粮油干货") return 180;
    if (category === "水果") {
      if (/香蕉|草莓|蓝莓|葡萄/i.test(name)) return 4;
      return 14;
    }
    if (category === "蔬菜") {
      if (/土豆|洋葱|南瓜|大蒜|生姜|大白菜/i.test(name)) return 21;
      return 5;
    }
    return 7;
  }

  // 冷藏 location
  if (category === "肉食" || category === "水产海鲜") return 3;
  if (category === "乳制品") {
    if (/蛋/i.test(name)) return 30;
    if (/酸奶|鲜奶|牛奶/i.test(name)) return 7;
    return 14;
  }
  if (category === "蔬菜") {
    if (/绿叶|青菜|菠菜|生菜|油麦菜|香菜/i.test(name)) return 4;
    if (/豆腐|豆干/i.test(name)) return 3;
    return 7;
  }
  if (category === "水果") return 7;
  return 10;
}

export function inferIngredientDefaults(name: string, explicitLocation?: StorageLocation): IngredientDefaults {
  const matched = COMMON_INGREDIENTS.find(
    (item) => item.name === name || name.includes(item.name) || item.name.includes(name)
  );

  const category = matched ? matched.category : inferCategoryByName(name);
  const storageLocation = explicitLocation || (matched ? matched.storageLocation : (
    category === "肉食" || category === "水产海鲜" ? "冷藏" :
    category === "乳制品" ? "冷藏" :
    category === "水果" ? "常温" :
    category === "粮油干货" || category === "调味品" ? "常温" : "冷藏"
  ));

  const shelfLifeDays = matched && (!explicitLocation || explicitLocation === matched.storageLocation)
    ? matched.shelfLifeDays
    : inferShelfLifeDays(name, storageLocation);

  const expirationDate = dateKeyAfterDays(shelfLifeDays);
  const defaultQuantity = matched ? matched.defaultQuantity : "1份";

  return {
    category,
    storageLocation,
    shelfLifeDays,
    expirationDate,
    defaultQuantity,
  };
}

export function searchCommonIngredients(query: string): CommonIngredient[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return COMMON_INGREDIENTS.slice(0, 10);
  return COMMON_INGREDIENTS.filter(
    (item) => item.name.toLowerCase().includes(trimmed) || item.category.toLowerCase().includes(trimmed)
  );
}
