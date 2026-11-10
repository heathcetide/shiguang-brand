import { kitchenPreferencesSchema } from "@dietdigidose/contracts";
import { z } from "zod";

export const permanentPreferencePayloadSchema = z.object({
  scope: z.literal("persistent"),
  preferences: kitchenPreferencesSchema.refine(value => Object.keys(value).length > 0, "请提供需要长期修改的偏好"),
}).strict();

export function hasPermanentPreferenceIntent(text: string) {
  // Quoted examples, questions and negated instructions cannot authorize a write.
  const unquoted = text.replace(/[“「『\"][^”」』\"]*[”」』\"]/g, "");
  const clauses = unquoted.match(/[^，,。；;！？!?\n]+[，,。；;！？!?\n]?/g) ?? [];
  return clauses.some(clause => {
    if (/[？?]|(?:吗|么)[。！!\s]*$|是否|能否|要不要|可不可以|是不是|如果|假如|例如|比如|你说|系统说/.test(clause)) return false;
    if (/(?:不要|不用|别|不必|不想|不需要|不能|不应|不是|并非|无需|未要求|没有要求|从未要求).{0,16}(?:保存|记住|长期|默认|以后|平时|通常|习惯)/.test(clause)) return false;
    if (/(?:只|仅|就)(?:是|限于|针对)?(?:今天|今晚|这次|本次|这一餐|这顿|暂时)/.test(clause)) return false;
    return /(?:以后|今后|从今).{0,20}(?:都|按|固定)|(?:长期|默认|平时|通常|习惯|记住)/.test(clause);
  });
}

export const permanentRecipePreferencePayloadSchema = z.object({
  scope: z.literal("persistent"),
  recipeId: z.number().int().positive(),
  version: z.number().int().positive(),
  value: z.enum(["dislike","neutral"]),
}).strict();
