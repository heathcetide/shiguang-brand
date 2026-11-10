import { z } from "zod";
import { recipeSubmissionSchema } from "../../validation/schemas.js";
import { recipeMinutesSchema } from "../../utils/recipeMinutes.js";

// Admin updates are partial. Creation defaults must not materialize omitted fields.
export const adminRecipeUpdateSchema = z.object(recipeSubmissionSchema.shape).partial().extend({
  description: z.string().trim().max(1000).optional(),
  cook_time: recipeMinutesSchema.optional(),
  prep_time: recipeMinutesSchema.optional(),
  source_url: z.string().trim().url().max(2000).nullable().optional(),
  data_license: z.string().trim().max(120).nullable().optional(),
  source_revision: z.string().trim().max(120).nullable().optional(),
  source_attribution: z.string().trim().max(300).nullable().optional(),
}).strict();
