import { z } from "zod";

/** A blank duration is unknown. Explicit zero is a separate, known value. */
export const recipeMinutesSchema = z.preprocess((value) => {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value === "string" && /^\d+(?:\s*分钟)?$/.test(value.trim())) return Number(value.trim().replace(/\s*分钟$/, ""));
  return value;
}, z.number().int().nonnegative().max(2_147_483_647).nullable());
