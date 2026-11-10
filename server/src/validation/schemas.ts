import { runtimePolicySchema } from "../modules/aiRuntime/policy.js";
import { recipeMinutesSchema } from "../utils/recipeMinutes.js";
import { accountPasswordSchema, kitchenwareAttributesSchema } from "@dietdigidose/contracts";
import { householdDiningPlanSchema, mealProductionSchema, kitchenPreferencesSchema } from "@dietdigidose/contracts";
import { z } from "zod";
import { inventoryConsumptionItemSchema } from "@dietdigidose/contracts";

export {
  inventoryBulkIntakeSchema,
  inventoryConsumptionPreviewSchema,
  inventoryConsumptionSchema,
  inventoryCreateSchema,
  inventoryUpdateSchema,
  shoppingInventoryImportSchema,
} from "@dietdigidose/contracts";

const trimmedString = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label}不能为空`).max(max, `${label}不能超过 ${max} 个字符`);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD").refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  "日期无效",
);

const optionalImage = z.string().trim().max(4_000_000, "图片过大").nullable().optional();
const nutrition = z.number().finite().min(0).max(100_000).nullable().optional();

export const mediaImageUploadSchema = z.object({
  data_url: z.string().max(5_600_000, "图片过大"),
  scope: z.literal("community"),
}).strict();

export const registerSchema = z.object({
  identifier: trimmedString(1, 254, "邮箱或手机号"),
  username: trimmedString(2, 30, "用户名"),
  password: accountPasswordSchema,
}).strict();

export const loginSchema = z.object({
  identifier: z.string().trim().max(254).optional(),
  password: z.string().min(1).max(128),
}).strict().refine((value) => value.identifier, {
  message: "请输入登录账号",
  path: ["identifier"],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: accountPasswordSchema,
}).strict();

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "请输入当前密码").max(128),
  confirmation: z.literal("DELETE", { message: "账号删除确认无效" }),
}).strict();

export const profileSchema = z.object({
  username: trimmedString(2, 30, "用户名").optional(),
  avatar_url: z.string().trim().max(4_000_000, "头像图片过大").nullable().optional(),
  bio: z.string().trim().max(500, "个人简介不能超过 500 个字符").nullable().optional(),
  daily_calories_target: z.number().int().min(500).max(10_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");

export const notificationPreferencesSchema = z.object({
  expiring_alert: z.boolean(),
  meal_reminder: z.boolean(),
  water_reminder: z.boolean(),
  breakfast_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "早餐提醒时间格式无效"),
  lunch_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "午餐提醒时间格式无效"),
  dinner_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "晚餐提醒时间格式无效"),
  water_start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "饮水开始时间格式无效"),
  water_end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "饮水结束时间格式无效"),
  water_interval_minutes: z.number().int().min(30).max(360),
  quiet_start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "静默开始时间格式无效"),
  quiet_end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "静默结束时间格式无效"),
  weekdays_enabled: z.boolean(),
  weekends_enabled: z.boolean(),
}).strict();

export const notificationActionSchema = z.object({
  action: z.enum(["open", "complete", "snooze_today", "plan_recipe"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const localNotificationEventSchema = z.object({
  kind: z.enum(["meal", "water"]),
  title: trimmedString(1, 80, "提醒标题"),
  body: trimmedString(1, 500, "提醒内容"),
  event: z.enum(["received", "opened"]),
  source_id: z.string().trim().max(200).optional(),
}).strict();

export const pushDeviceSchema = z.object({
  expo_push_token: z.string().trim().regex(/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/, "无效的 Expo Push Token"),
  platform: z.enum(["ios", "android"]),
}).strict();

export const notificationCampaignSchema = z.object({
  title: trimmedString(1, 80, "通知标题"),
  body: trimmedString(1, 500, "通知内容"),
}).strict();

export const feedbackCreateSchema = z.object({
  requestKey: z.string().uuid().optional(),
  category: z.enum(["issue", "suggestion", "support"]),
  content: trimmedString(5, 2000, "反馈内容"),
  context: z.object({
    page: z.string().trim().max(120).optional(),
    recipeId: z.number().int().positive().optional(),
    recipeTitle: z.string().trim().max(160).optional(),
    appVersion: z.string().trim().max(40).optional(),
    snapshot: z.string().trim().max(40).optional(),
    platform: z.enum(["ios", "android", "web"]).optional(),
  }).strict().optional(),
}).strict();

export const dietRecordCreateSchema = z.object({
  idempotency_key: z.string().trim().min(16,"保存编号格式无效").max(200,"保存编号过长").optional(),
  meal_type: z.string().trim().max(30, "餐别标签不能超过 30 个字符").default(""),
  food_name: trimmedString(1, 120, "食物名称"),
  amount: trimmedString(1, 40, "分量").default("1份"),
  calories: nutrition,
  protein: nutrition,
  carbs: nutrition,
  fat: nutrition,
  recorded_at: isoDate.optional(),
  recorded_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "进食时间格式必须为 HH:mm").nullable().optional(),
  image_url: optionalImage,
}).strict();

export const cookingCompletionSchema = z.object({
  idempotency_key: z.string().trim().min(16, "幂等键格式无效").max(200, "幂等键过长"),
  recipe_id: z.number().int().positive().nullable().optional(),
  inventory_item_ids: z.array(z.number().int().positive()).max(100).default([]),
  inventory_consumptions: z.array(inventoryConsumptionItemSchema).max(100).default([]),
  diet_record: dietRecordCreateSchema.optional(),
  production: mealProductionSchema.optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.production) === Boolean(value.diet_record)) context.addIssue({ code: "custom", path: ["production"], message: "请提供制作分配或旧版饮食记录，不能同时提交" });
  if (new Set(value.inventory_consumptions.map(item => item.item_id)).size !== value.inventory_consumptions.length) context.addIssue({ code: "custom", path: ["inventory_consumptions"], message: "同一批次不能重复扣减" });
  if (value.inventory_item_ids.length && value.inventory_consumptions.length) {
    context.addIssue({ code: "custom", path: ["inventory_consumptions"], message: "不能同时使用旧版整项扣减和结构化扣减" });
  }
});

const cookingQueueStatus = z.enum(["waiting", "preparing", "ready", "cooking", "completed", "cancelled"]);
const cookingQueueMealType = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const nullableDateTime = z.string().datetime({ offset: true, message: "计划时间必须是包含时区的 ISO 时间" }).nullable();

export const cookingQueueCreateSchema = z.object({
  interventionId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  confirmed: z.literal(true).optional(),
  recommendationRequestId: z.string().uuid().optional(),
  recipeId: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  plannedAt: nullableDateTime.optional(),
  mealType: cookingQueueMealType.nullable().optional(),
}).strict();

export const cookingQueueUpdateSchema = z.object({
  version: z.number().int().positive(),
  status: cookingQueueStatus.optional(),
  plannedAt: nullableDateTime.optional(),
  mealType: cookingQueueMealType.nullable().optional(),
  preparedIngredientNames: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  shoppingListSyncedAt: nullableDateTime.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), "至少提供一个需要更新的字段");

export const cookingQueueVersionSchema = z.object({
  version: z.number().int().positive(),
}).strict();

export const cookingQueueReorderSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
  }).strict()).min(1).max(30),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "队列项不能重复" });
  }
});

export const healthLogSchema = z.object({
  weight: z.number().finite().min(20).max(500).nullable().optional(),
  body_fat: z.number().finite().min(1).max(75).nullable().optional(),
  water_ml: z.number().int().min(0).max(20_000).nullable().optional(),
  height_cm: z.number().finite().min(80).max(250).nullable().optional(),
  waist_cm: z.number().finite().min(30).max(300).nullable().optional(),
  hip_cm: z.number().finite().min(30).max(300).nullable().optional(),
  resting_heart_rate: z.number().int().min(20).max(250).nullable().optional(),
  blood_pressure_systolic: z.number().int().min(50).max(300).nullable().optional(),
  blood_pressure_diastolic: z.number().int().min(30).max(200).nullable().optional(),
  blood_glucose_mmol: z.number().finite().min(1).max(50).nullable().optional(),
  cycle_status: z.enum(["经期", "备孕", "孕期", "产后", "哺乳期"]).nullable().optional(),
  sleep_hours: z.number().finite().min(0).max(24).nullable().optional(),
  recorded_date: isoDate.optional(),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "recorded_date"),
  "至少填写一项健康数据",
);

export const healthProfileSchema = z.object({
  gender: z.enum(["男", "女", "保密", "male", "female", "other"]).nullable().optional(),
  age: z.number().int().min(12).max(120).nullable().optional(),
  height: z.number().finite().min(80).max(250).nullable().optional(),
  weight: z.number().finite().min(20).max(500).nullable().optional(),
  target_weight: z.number().finite().min(20).max(500).nullable().optional(),
  health_goal: z.enum(["lose_weight", "reduce_fat", "gain_muscle", "maintain", "healthy"]).optional(),
  activity_level: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).optional(),
  dietary_preference: z.string().trim().max(200).optional(),
  allergies: z.array(z.object({
    name: trimmedString(1, 80, "过敏或不耐受名称"),
    type: z.enum(["allergy", "intolerance"]),
    severity: z.enum(["mild", "moderate", "severe"]),
  }).strict()).max(30).optional(),
  medications: z.string().trim().max(1000).optional(),
  medical_conditions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  medical_notes: z.string().trim().max(1000).optional(),
  dietary_restrictions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  disliked_foods: z.string().trim().max(1000).optional(),
  kitchen_constraints: kitchenPreferencesSchema.optional(),
  nutrition_targets: z.object({
    calories_kcal: z.number().finite().min(500).max(10_000).nullable().optional(),
    protein_g: z.number().finite().min(0).max(1000).nullable().optional(),
    salt_g: z.number().finite().min(0).max(100).nullable().optional(),
    sugar_g: z.number().finite().min(0).max(1000).nullable().optional(),
    water_ml: z.number().finite().min(0).max(20_000).nullable().optional(),
    professional_advice: z.string().trim().max(1000).optional(),
  }).strict().optional(),
  tracking_enabled: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");

export const customFoodSchema = z.object({
  name: trimmedString(1, 120, "食材名称"),
  calories_100g: z.number().finite().min(0).max(10_000),
  protein_100g: z.number().finite().min(0).max(1000).default(0),
  carbs_100g: z.number().finite().min(0).max(1000).default(0),
  fat_100g: z.number().finite().min(0).max(1000).default(0),
}).strict();

const communityImage = z.string().trim().max(2048, "图片 URL 过长").refine(
  (value) => value.startsWith("/media/uploads/") || URL.canParse(value),
  "图片必须来自受控对象存储",
);
export const communityPostSchema = z.object({
  content: z.string().trim().max(5000, "动态内容不能超过 5000 个字符").default(""),
  image_url: communityImage.nullable().optional(),
  image_urls: z.array(communityImage).max(9, "最多上传 9 张图片").optional(),
  category: z.enum(["寻味", "榜单", "活动", "问答"]).default("寻味"),
  event_start_at: z.string().trim().nullable().optional(),
  event_end_at: z.string().trim().nullable().optional(),
  linked_recipe_id: z.number().int().positive().nullable().optional(),
}).strict().superRefine((value, context) => {
  const images = value.image_urls?.length || (value.image_url ? 1 : 0);
  if (!value.content && !images && !value.linked_recipe_id) {
    context.addIssue({ code: "custom", path: ["content"], message: "动态内容、图片或关联菜谱不能为空" });
  }
  if (value.category === "活动") {
    const start = value.event_start_at ? Date.parse(value.event_start_at) : Number.NaN;
    const end = value.event_end_at ? Date.parse(value.event_end_at) : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      context.addIssue({ code: "custom", path: ["event_start_at"], message: "活动需要有效的开始和结束日期" });
    } else if (end < start) {
      context.addIssue({ code: "custom", path: ["event_end_at"], message: "活动结束日期不能早于开始日期" });
    }
  }
});

export const communityCommentSchema = z.object({
  content: z.string().trim().max(2000, "评论不能超过 2000 个字符").default(""),
  image_url: communityImage.nullable().optional(),
}).strict().refine((value) => value.content || value.image_url, "评论内容或图片不能为空");

const recipeArrayOrJson = z.union([z.array(z.unknown()), z.string().max(100_000)]);
export const recipeSubmissionSchema = z.object({
  title: trimmedString(2, 80, "食谱标题"),
  description: z.string().trim().max(1000).default(""),
  image_url: z.string().trim().max(4_000_000).optional(),
  cook_time: recipeMinutesSchema,
  difficulty: z.string().trim().max(20).optional(),
  calories: z.union([z.number(), z.string()]).optional(),
  protein: z.union([z.number(), z.string()]).optional(),
  carbs: z.union([z.number(), z.string()]).optional(),
  fat: z.union([z.number(), z.string()]).optional(),
  nutrition: recipeArrayOrJson.optional(),
  nutrition_json: recipeArrayOrJson.optional(),
  category: z.string().trim().max(40).optional(),
  tags: recipeArrayOrJson.optional(),
  steps: recipeArrayOrJson.optional(),
  steps_json: recipeArrayOrJson.optional(),
  ingredients: recipeArrayOrJson.optional(),
  ingredients_json: recipeArrayOrJson.optional(),
  serving_size: z.union([z.number(), z.string()]).optional(),
  prep_time: recipeMinutesSchema,
  cuisine: z.string().trim().max(80).optional(),
  meal_types: recipeArrayOrJson.optional(),
  required_kitchenware: recipeArrayOrJson.optional(),
  optional_kitchenware: recipeArrayOrJson.optional(),
  source_url: z.string().trim().url().max(2000).optional(),
  data_license: z.string().trim().max(120).optional(),
  source_revision: z.string().trim().max(120).optional(),
  source_attribution: z.string().trim().max(300).optional(),
}).strict().refine((value) => value.steps !== undefined || value.steps_json !== undefined, "请至少填写一个烹饪步骤")
  .refine((value) => value.ingredients !== undefined || value.ingredients_json !== undefined, "请至少填写一种食材");

const imagePayload = z.string().trim().min(1, "缺少图片数据").max(7_500_000, "图片过大").refine(
  (value) => !value.startsWith("data:") || /^data:image\/(jpeg|png|webp|heic|heif);base64,/i.test(value),
  "只支持 JPEG、PNG、WebP 或 HEIC 图片",
);
const aiChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12_000),
}).strict();

// 对话历史保存在客户端，旧版本或损坏的缓存不应阻止一条新的有效提问。
// 此处只清洗 AI 上下文，不降低其他业务接口的严格校验。
const normalizeAIChatPayload = (input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  const normalizedMessages = Array.isArray(raw.messages)
    ? raw.messages.flatMap((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return [];
      const item = message as Record<string, unknown>;
      if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") return [];
      const content = item.content.trim().slice(0, 12_000);
      return content ? [{ role: item.role, content }] : [];
    })
    : [];
  // System instructions are server-owned. Silently discard them here so old
  // clients keep working without elevating untrusted text to system level.
  const messages = normalizedMessages.slice(-50);
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim().slice(0, 12_000) : undefined;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim().slice(0, 120) : undefined;
  const source = raw.source === "voice" || raw.source === "cooking" ? raw.source : "assistant";
  const image = typeof raw.image === "string" ? raw.image.trim() : undefined;
  const imageMimeType = typeof raw.imageMimeType === "string" ? raw.imageMimeType.trim().toLowerCase() : undefined;
  return {
    ...(messages.length ? { messages } : {}),
    ...(prompt ? { prompt } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(raw.idempotencyKey !== undefined ? { idempotencyKey: raw.idempotencyKey } : {}),
    ...(image ? { image } : {}),
    ...(imageMimeType ? { imageMimeType } : {}),
    source,
  };
};

export const aiChatSchema = z.preprocess(normalizeAIChatPayload, z.object({
  idempotencyKey: z.string().trim().min(16).max(200).optional(),
  messages: z.array(aiChatMessageSchema).max(50).optional(),
  prompt: z.string().min(1).max(12_000).optional(),
  sessionId: z.string().max(120).optional(),
  image: imagePayload.optional(),
  imageMimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]).optional(),
  source: z.enum(["assistant", "voice", "cooking"]).default("assistant"),
}).strict().refine((value) => value.prompt || value.messages?.length || value.image, "必须提供 prompt、messages 或图片"));

export const aiWriteConfirmationCommitSchema = z.object({
  idempotencyKey: z.string().trim().min(16, "幂等键格式无效").max(200, "幂等键过长"),
}).strict();

export const aiHomeRecommendationsSchema = z.object({
  period: z.string().trim().max(40).optional(),
  requestKey: z.string().trim().min(1).max(2000).optional(),
}).strict();

export const aiVisionSchema = z.object({
  image: imagePayload,
  userPrompt: z.string().trim().max(1000).optional(),
}).strict();

export const aiImageSchema = z.object({ image: imagePayload }).strict();

export const aiVoiceCommandSchema = z.object({
  speechText: trimmedString(1, 1000, "语音识别文本"),
  sessionId: z.string().trim().min(1).max(120),
  currentStep: z.number().int().min(0).max(1000).default(0),
  recipeTitle: z.string().trim().max(120).default(""),
  recipeSteps: z.array(z.string().max(2000)).max(100).optional(),
  recipeIngredients: z.array(z.string().max(500)).max(100).optional(),
  voiceHistory: z.array(z.object({
    question: z.string().trim().min(1).max(1000),
    answer: z.string().trim().min(1).max(2000),
  }).strict()).max(3).optional(),
}).strict();

export const aiTranscribeSchema = z.object({
  audioBase64: z.string().trim().min(1, "缺少音频数据").max(7_500_000, "音频过大"),
  mimeType: z.enum([
    "audio/m4a", "audio/mp4", "audio/mpeg", "audio/wav", "audio/webm", "audio/x-m4a",
  ]).default("audio/m4a"),
}).strict();

export const realtimeVoiceSessionSchema = z.object({
  recipeId: z.number().int().positive(),
  platform: z.enum(["android", "ios", "web"]),
  idempotencyKey: z.string().trim().min(16).max(200),
  currentStep: z.number().int().min(0).max(1000).default(0),
  recipeSteps: z.array(z.string().trim().min(1).max(2000)).max(100).default([]),
  recipeIngredients: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
}).strict();

export const realtimeVoiceHeartbeatSchema = z.object({
  version: z.number().int().positive(),
  muted: z.boolean().optional(),
  reconnect: z.boolean().default(false),
}).strict();

export const realtimeVoiceTurnSchema = z.object({
  turnId: z.string().uuid(),
  transcript: z.string().trim().min(1).max(1000),
  currentStep: z.number().int().min(0).max(1000),
  timerSeconds: z.number().int().min(0).max(86_400),
  timerRunning: z.boolean(),
  interruptedResponse: z.boolean().default(false),
}).strict();

export const realtimeVoiceAudioChunkSchema = z.object({
  turnId: z.string().uuid(),
  sequence: z.number().int().min(1).max(1000),
  audioBase64: z.string().trim().min(1).max(7_500_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "音频分段不是有效 Base64"),
  mimeType: z.enum(["audio/wav", "audio/webm"]),
  final: z.boolean().default(false),
}).strict();

const agentActionEditSchema = z.object({
  id: z.string().uuid().optional(),
  actionType: z.enum([
    "create_meal_plan", "update_meal_plan", "add_shopping_items", "update_shopping_item",
    "delete_meal_plan", "delete_shopping_item", "record_diet_meal", "add_inventory_item",
    "update_inventory_item", "consume_inventory_items", "produce_meal", "record_prepared_meal_event", "add_kitchenware_item", "submit_recipe",
    "update_kitchen_preferences", "update_recipe_preference", "record_health_log",
  ]),
  summary: z.string().trim().min(1).max(300),
  payload: z.record(z.string(), z.unknown()),
  riskLevel: z.enum(["low", "high", "forbidden"]).optional(),
  version: z.number().int().positive().optional(),
}).strict();

export const agentRunResumeSchema = z.union([
  z.object({ input: z.string().trim().min(1).max(4000) }).strict(),
  z.object({
    decision: z.enum(["approve", "reject", "edit"]),
    actions: z.array(agentActionEditSchema).max(150).optional(),
  }).strict().superRefine((value, context) => {
    if (value.decision === "edit" && !value.actions?.length) {
      context.addIssue({ code: "custom", path: ["actions"], message: "编辑批准包时必须提供操作" });
    }
  }),
]);

export const shoppingListItemCreateSchema = z.object({
  clientId: z.string().trim().max(120).optional(),
  name: trimmedString(1, 120, "采购项名称"),
  amount: z.string().trim().min(1).max(80).default("适量"),
  category: z.string().trim().min(1).max(40).default("其他"),
  checked: z.boolean().default(false),
  purchaseDate: isoDate.optional(),
  storageLocation: z.string().trim().max(40).optional(),
}).strict();

export const shoppingListItemUpdateSchema = shoppingListItemCreateSchema.partial().extend({
  version: z.number().int().positive(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), "至少提供一个需要更新的字段");

export const shoppingListImportSchema = z.object({
  importKey: z.string().trim().min(16).max(200),
  items: z.array(shoppingListItemCreateSchema).max(500),
}).strict();

export const mealPlanUpdateSchema = z.object({
  version: z.number().int().positive(),
  title: trimmedString(1, 120, "餐单标题").optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  status: z.enum(["draft", "active", "completed", "cancelled"]).optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value).every((key) => key === "version")) {
    context.addIssue({ code: "custom", message: "至少提供一个需要更新的字段" });
  }
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "结束日期不能早于开始日期" });
  }
});

export const mealPlanVersionSchema = z.object({
  version: z.number().int().positive(),
}).strict();

export const mealPlanItemUpdateSchema = z.object({
  validationFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  dining: householdDiningPlanSchema.nullable().optional(),
  version: z.number().int().positive(),
  plannedDate: isoDate.optional(),
  mealType: trimmedString(1, 30, "餐次").optional(),
  recipeId: z.number().int().positive().nullable().optional(),
  status: z.enum(["planned", "skipped"]).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version" && key !== "validationFingerprint"), "至少提供一个需要更新的字段");

const mealPlanExecutionBaseSchema = z.object({
  version: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(16).max(200),
}).strict();

export const mealPlanShoppingSchema = mealPlanExecutionBaseSchema.extend({ householdNetFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),householdRecipeFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),householdTotalDemand: householdDiningPlanSchema.optional() }).strict();
export const mealPlanQueueSchema = mealPlanExecutionBaseSchema.extend({ combineSameRecipe: z.boolean().optional() }).strict();
export const mealPlanCompleteSchema = mealPlanExecutionBaseSchema.extend({
  dietRecordId: z.number().int().positive().optional(),
  production: mealProductionSchema.optional(),
  inventory_consumptions: z.array(inventoryConsumptionItemSchema).max(100).optional(),
}).strict();

export const householdShoppingCreateSchema = z.object({
  name: trimmedString(1, 120, "采购项名称"),
  amount: z.string().trim().min(1).max(80).default("适量"),
  category: z.string().trim().min(1).max(40).default("其他"),
  storageLocation: z.string().trim().max(40).optional(),
  expirationDate: isoDate.optional(),
}).strict();

export const householdShoppingUpdateSchema = householdShoppingCreateSchema.partial().extend({
  version: z.number().int().positive(),
  checked: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), "至少提供一个需要更新的字段");

export const householdShoppingIntakeSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(200),
  items: z.array(z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    quantity: z.string().trim().min(1).max(80),
    expirationDate: isoDate,
    storageLocation: z.string().trim().min(1).max(40),
  }).strict()).min(1).max(200),
}).strict();

export const householdTransferOwnerSchema = z.object({
  newOwnerUserId: z.number().int().positive(),
  version: z.number().int().positive(),
}).strict();

const inventoryOutcome = z.enum(["cooked", "used", "discarded", "expired", "gifted", "transferred", "unknown"]);
const inventoryOutcomeSource = z.enum(["manual", "cooking", "reminder", "recommendation", "cleanup"]);

export const inventoryOutcomeCreateSchema = z.object({
  interventionId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  confirmed: z.literal(true).optional(),
  scope: z.enum(["personal", "household"]),
  itemId: z.number().int().positive(),
  householdId: z.number().int().positive().optional(),
  itemVersion: z.number().int().positive().optional(),
  outcome: inventoryOutcome,
  source: inventoryOutcomeSource.default("manual"),
  idempotencyKey: z.string().trim().min(16).max(200),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  closeItem: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (value.scope === "household" && !value.householdId) context.addIssue({ code: "custom", path: ["householdId"], message: "家庭结果必须指定家庭空间" });
  if (value.scope === "personal" && value.householdId) context.addIssue({ code: "custom", path: ["householdId"], message: "个人结果不能指定家庭空间" });
});

export const inventoryOutcomeUpdateSchema = z.object({
  version: z.number().int().positive(),
  outcome: inventoryOutcome,
}).strict();

export const recipeRecommendationSchema = z.object({
  surface: z.enum(["home", "inventory", "ai", "meal_plan"]).default("inventory"),
  category: z.string().trim().max(40).optional(),
  search: z.string().trim().max(120).optional(),
  maxCookTime: z.number().int().min(1).max(480).optional(),
  matchStatus: z.enum(["all", "full", "missing_few", "expiring"]).default("all"),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  pageSize: z.number().int().min(1).max(50).default(12),
  cursor: z.string().trim().max(1000).optional(),
}).strict();

export const recipeRecommendationEventSchema = z.object({
  requestId: z.string().uuid().optional(),
  recipeId: z.number().int().positive(),
  eventType: z.enum(["exposure", "view", "favorite", "skip", "shopping", "queue", "start", "complete", "constraint_change"]),
  scoringVersion: z.string().trim().min(1).max(80),
  surface: z.enum(["home", "inventory", "ai", "meal_plan"]),
  idempotencyKey: z.string().trim().min(16).max(200),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const kitchenwareSchema = z.object({
  attributes: kitchenwareAttributesSchema.optional(),
  name: trimmedString(1, 80, "厨具名称"),
  category: z.enum(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]).default("其他"),
  status: z.enum(["常用", "良好", "需保养", "维修中", "闲置"]).default("良好"),
  note: z.string().trim().max(300).default(""),
  image_url: z.string().trim().max(4_000_000).nullable().optional(),
  purchase_date: z.union([isoDate, z.literal("")]).nullable().optional(),
}).strict();

export const adminRoleSchema = z.object({ role: z.enum(["user", "admin"]) }).strict();
export const adminExpertSchema = z.object({ is_verified_expert: z.boolean() }).strict();
export const adminUserStatusSchema = z.object({ is_disabled: z.boolean() }).strict();
export const adminLevelAdjustmentSchema = z.object({
  xp_delta: z.number().int().min(-10_000).max(10_000).refine((value) => value !== 0, "经验调整不能为 0"),
  reason: trimmedString(2, 200, "调整原因"),
}).strict();
export const adminUserLevelRuleSchema = z.object({
  levels: z.array(z.object({
    level: z.number().int().min(1).max(20),
    title: trimmedString(1, 20, "等级称号"),
    requiredXp: z.number().int().min(0).max(10_000_000),
  }).strict()).min(2, "至少配置两个等级").max(20, "最多配置 20 个等级"),
  xp: z.object({
    dietRecord: z.number().int().min(0).max(10_000),
    streakDay: z.number().int().min(0).max(10_000),
    recipeFavorite: z.number().int().min(0).max(10_000),
    communityPost: z.number().int().min(0).max(10_000),
    follower: z.number().int().min(0).max(10_000),
    dailyCheckIn: z.number().int().min(0).max(10_000),
  }).strict(),
}).strict().superRefine((value, context) => {
  value.levels.forEach((item, index) => {
    if (item.level !== index + 1) {
      context.addIssue({ code: "custom", path: ["levels", index, "level"], message: "等级编号必须从 1 连续递增" });
    }
    if (index === 0 && item.requiredXp !== 0) {
      context.addIssue({ code: "custom", path: ["levels", index, "requiredXp"], message: "第一级门槛必须为 0 XP" });
    }
    if (index > 0 && item.requiredXp <= value.levels[index - 1].requiredXp) {
      context.addIssue({ code: "custom", path: ["levels", index, "requiredXp"], message: "升级门槛必须严格递增" });
    }
  });
});
export const adminUserCredentialsSchema = z.object({
  identifier: z.string().trim().min(1, "邮箱或手机号不能为空").max(254, "邮箱或手机号不能超过 254 个字符").optional(),
  newPassword: accountPasswordSchema
    .optional(),
}).strict().refine((value) => value.identifier !== undefined || value.newPassword !== undefined, "至少提供一个需要更新的字段");
export const adminKitchenwareStatusSchema = z.object({
  status: z.enum(["常用", "良好", "需保养", "维修中", "闲置"]),
}).strict();
export const adminKitchenwareCatalogSchema = z.object({
  name: trimmedString(1, 80, "厨具名称"),
  category: z.enum(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]),
  aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  cooking_methods: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  care_note: z.string().trim().max(300).default(""),
}).strict();
export const adminRecipeRejectSchema = z.object({ reason: trimmedString(2, 300, "驳回原因") }).strict();
export const adminRecipeQualitySchema = z.object({
  status: z.enum(["trusted", "needs_review"]),
  reason: trimmedString(2, 300, "审核原因"),
}).strict();
export const adminEventSchema = z.object({
  event_start_at: z.string().trim().min(1),
  event_end_at: z.string().trim().min(1),
}).strict().refine((value) => {
  const start = Date.parse(value.event_start_at);
  const end = Date.parse(value.event_end_at);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}, "活动日期无效或结束时间早于开始时间");
export const adminQuestionSchema = z.object({
  question_status: z.enum(["open", "resolved"]),
  accepted_comment_id: z.number().int().positive().nullable().optional(),
}).strict();
export const adminIngredientSchema = customFoodSchema.extend({
  calories_100g: z.number().finite().min(0).max(1000).nullable().default(null),
  protein_100g: z.number().finite().min(0).max(100).nullable().default(null),
  carbs_100g: z.number().finite().min(0).max(100).nullable().default(null),
  fat_100g: z.number().finite().min(0).max(100).nullable().default(null),
  category: z.string().trim().max(80).nullable().optional(),
  source: z.string().trim().min(1).max(80).default("official"),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  search_keywords: z.string().trim().max(500).default(""),
  preparation_state: z.string().trim().min(1).max(40).default("unspecified"),
  source_version: z.string().trim().min(1).max(120).default("manual-v1"),
  data_license: z.string().trim().min(1).max(120).default("DietDigiDose-Original"),
  edible_ratio: z.number().positive().max(1).default(1),
}).strict();
// PUT still requires name; omitted fields are preserved, while explicit nutrient/category null clears them.
export const adminIngredientUpdateSchema = adminIngredientSchema.extend({
  calories_100g: adminIngredientSchema.shape.calories_100g.removeDefault().optional(),
  protein_100g: adminIngredientSchema.shape.protein_100g.removeDefault().optional(),
  carbs_100g: adminIngredientSchema.shape.carbs_100g.removeDefault().optional(),
  fat_100g: adminIngredientSchema.shape.fat_100g.removeDefault().optional(),
  source: adminIngredientSchema.shape.source.removeDefault().optional(),
  aliases: adminIngredientSchema.shape.aliases.removeDefault().optional(),
  search_keywords: adminIngredientSchema.shape.search_keywords.removeDefault().optional(),
  preparation_state: adminIngredientSchema.shape.preparation_state.removeDefault().optional(),
  source_version: adminIngredientSchema.shape.source_version.removeDefault().optional(),
  data_license: adminIngredientSchema.shape.data_license.removeDefault().optional(),
  edible_ratio: adminIngredientSchema.shape.edible_ratio.removeDefault().optional(),
}).strict();
const optionalUrlSchema = z.string().trim().max(2000).optional().refine(
  (val) => !val || /^https?:\/\/\S+/i.test(val),
  "请输入包含 http:// 或 https:// 的有效接口地址 (Base URL)"
);

export const adminAIConfigSchema = z.object({
  draftRevision: z.number().int().nonnegative(),
  runtimePolicy: runtimePolicySchema.optional(),
  apiKey: z.string().trim().max(1000).optional(),
  baseUrl: optionalUrlSchema,
  model: z.string().trim().max(200).optional(),
  visionModel: z.string().trim().max(200).optional(),
  asrModel: z.string().trim().max(200).optional(),
  supervisorModel: z.string().trim().max(200).optional(),
  nutritionModel: z.string().trim().max(200).optional(),
  recipeModel: z.string().trim().max(200).optional(),
  operationsModel: z.string().trim().max(200).optional(),

  chatApiKey: z.string().trim().max(1000).optional(),
  chatBaseUrl: optionalUrlSchema,
  chatModel: z.string().trim().max(200).optional(),

  visionApiKey: z.string().trim().max(1000).optional(),
  visionBaseUrl: optionalUrlSchema,

  asrApiKey: z.string().trim().max(1000).optional(),
  asrBaseUrl: optionalUrlSchema,

  systemPrompt: z.string().trim().max(12_000, "人设提示词不能超过 12000 个字符").refine(value => !value || value.length >= 20, "人设提示词至少需要 20 个字符，或留空恢复默认").optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");
export const adminAIConfigTestSchema = z.object({
  service: z.enum(["chat", "vision", "asr"]).optional(),
  apiKey: z.string().trim().max(1000).optional(),
  baseUrl: optionalUrlSchema,
  model: z.string().trim().min(1).max(200).optional(),
}).strict();

export const adminSiteSettingsSchema = z.object({
  filingEnabled: z.boolean(),
  filingText: z.string().trim().max(120, "备案展示内容不能超过 120 个字符"),
  filingUrl: z.string().trim().max(2000, "备案链接不能超过 2000 个字符").refine(
    (value) => !value || /^https?:\/\/\S+$/i.test(value),
    "备案链接必须以 http:// 或 https:// 开头",
  ),
}).strict().refine(
  (value) => !value.filingEnabled || value.filingText.length > 0,
  { path: ["filingText"], message: "启用展示时必须填写备案内容" },
);
