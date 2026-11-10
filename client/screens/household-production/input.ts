import { parseStructuredQuantity } from "@/utils/structuredQuantity";
export function actualQuantity(value: string) {
  if (!/^\d+(?:\.\d+)?\s*(?:kg|千克|公斤|ml|毫升|[g克l升个枚只片份袋盒瓶罐])$/i.test(value.trim())) return null;
  return parseStructuredQuantity(value);
}
