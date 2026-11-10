import { Converter } from "opencc-js";

const TRADITIONAL_TO_SIMPLIFIED: Record<string, string> = {
  "蕃": "番", "馬": "马", "鈴": "铃", "薯": "薯", "雞": "鸡", "魚": "鱼",
  "蝦": "虾", "豬": "猪", "蔥": "葱", "薑": "姜", "蒜": "蒜", "蘿": "萝",
  "蔔": "卜", "麵": "面", "飯": "饭", "湯": "汤", "醬": "酱", "鹽": "盐",
};
const toSimplified = Converter({ from: "tw", to: "cn" });

/** Pure content normalization shared by database-independent domain services. */
export function normalizeContentTerm(value: string) {
  return toSimplified(value.normalize("NFKC").toLocaleLowerCase()).split("")
    .map((character) => TRADITIONAL_TO_SIMPLIFIED[character] || character)
    .join("")
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/[\s·、，,。()（）/\\_-]/g, "")
    .trim();
}
