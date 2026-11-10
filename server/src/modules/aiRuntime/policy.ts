import { z } from "zod";

export const modelPolicySchema = z.object({
  thinking: z.enum(["default", "off", "high", "max"]).default("default"),
  thinkingBudget: z.number().int().min(1024).max(32768).optional(),
  maxTokens: z.number().int().min(128).max(16000).default(3000),
  timeoutMs: z.number().int().min(1000).max(180000).default(60000),
  retries: z.number().int().min(0).max(2).default(0),
}).strict();
export type ModelPolicy = z.infer<typeof modelPolicySchema>;
export const runtimePolicySchema = z.object({
  main: modelPolicySchema.default(() => modelPolicySchema.parse({})),
  planner: modelPolicySchema.default(() => modelPolicySchema.parse({})),
  vision: modelPolicySchema.default(() => modelPolicySchema.parse({})),
  asr: modelPolicySchema.default(() => modelPolicySchema.parse({})),
  deadlineMs: z.number().int().min(1000).max(300000).default(180000),
  maxModelCalls: z.number().int().min(1).max(30).default(12),
  maxToolCalls: z.number().int().min(1).max(12).default(6),
}).strict();

// 既有 toggle/budget 兼容名单（未做供应商实测）
export const SILICONFLOW_THINKING_MODELS = [
  "Pro/deepseek-ai/DeepSeek-V4",
  "deepseek-ai/DeepSeek-V4-Flash",
  "Pro/zai-org/GLM-5.2",
  "deepseek-ai/DeepSeek-R1",
  "deepseek-ai/DeepSeek-V3",
  "Pro/deepseek-ai/DeepSeek-R1",
  "Pro/deepseek-ai/DeepSeek-V3",
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
  "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
] as const;

// 官方明确支持 reasoning_effort (high/max) 的模型：https://docs.siliconflow.cn/docs/api/chat-completions-post
export const SILICONFLOW_REASONING_EFFORT_MODELS = [
  "Pro/deepseek-ai/DeepSeek-V4",
  "deepseek-ai/DeepSeek-V4-Flash",
  "Pro/zai-org/GLM-5.2",
] as const;

const thinkingModels = new Set<string>(SILICONFLOW_THINKING_MODELS);
const effortModels = new Set<string>(SILICONFLOW_REASONING_EFFORT_MODELS);
export function thinkingParameters(baseUrl: string, model: string, policy: ModelPolicy): Record<string, unknown> {
  if (policy.thinking === "default" && !policy.thinkingBudget) return {};
  const host = new URL(baseUrl).hostname;
  if (!["api.siliconflow.cn", "api.siliconflow.com"].includes(host) || !thinkingModels.has(model)) {
    throw new Error(`模型 ${model} 的思考参数尚未验证，请选择“提供商默认”或使用已确认支持的模型`);
  }
  if (policy.thinking === "off") {
    return { enable_thinking: false };
  }
  if ((policy.thinking === "high" || policy.thinking === "max") && !effortModels.has(model)) {
    throw new Error(`模型 ${model} 的推理强度尚未验证，请选择“提供商默认”或使用支持 reasoning_effort 的模型`);
  }
  return {
    enable_thinking: true,
    ...(policy.thinking !== "default" ? { reasoning_effort: policy.thinking } : {}),
    ...(policy.thinkingBudget ? { thinking_budget: policy.thinkingBudget } : {}),
  };
}

export function isTransientModelError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (/预算已用尽|CANCELLED|已取消|ABORT_ERR/i.test(message)) return false;
  const status = Number((error as { status?: unknown })?.status);
  if (status) {
    if ([400, 401, 403, 404, 422].includes(status)) return false;
    return status === 429 || status >= 500;
  }
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(message);
}
