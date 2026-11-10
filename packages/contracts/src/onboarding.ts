import { z } from "zod";

export const onboardingTaskSchema = z.enum(["inventory", "meal_plan", "diet_record", "nutrition"]);
export const onboardingStatusSchema = z.enum(["not_started", "in_progress", "paused", "completed"]);
export const onboardingStepSchema = z.enum(["choose_task", "conditions", "task"]);
export const onboardingCompletionSchema = z.object({
  task: onboardingTaskSchema,
  resourceId: z.string(),
}).strict();
export const onboardingStateSchema = z.object({
  version: z.number().int().nonnegative(),
  selectedTask: onboardingTaskSchema.nullable(),
  status: onboardingStatusSchema,
  step: onboardingStepSchema,
  dismissed: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  completion: onboardingCompletionSchema.nullable(),
  updatedAt: z.string().nullable(),
}).strict();
export const onboardingUpdateSchema = z.object({
  version: z.number().int().nonnegative(),
  requestKey: z.string().uuid().optional(),
  selectedTask: onboardingTaskSchema.optional(),
  status: onboardingStatusSchema.optional(),
  step: onboardingStepSchema.optional(),
  dismissed: z.boolean().optional(),
  completion: onboardingCompletionSchema.optional(),
}).strict();
export const onboardingFailureSchema = z.object({
  requestKey: z.string().uuid(),
}).strict();
export type OnboardingTask = z.infer<typeof onboardingTaskSchema>;
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export type OnboardingUpdate = z.infer<typeof onboardingUpdateSchema>;
export type OnboardingCompletion = z.infer<typeof onboardingCompletionSchema>;
