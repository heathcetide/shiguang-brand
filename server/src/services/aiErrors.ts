export type AIErrorDetails = {
  code: string;
  type: "configuration" | "timeout" | "rate_limit" | "network" | "provider" | "server";
  adminMessage: string;
  publicMessage: string;
};

export function sanitizeAIErrorMessage(value: unknown) {
  const raw = value instanceof Error ? value.message : String(value || "AI provider error");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/([?&](?:api_?key|token|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/("?(?:api_?key|authorization|token|secret)"?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2")
    .replace(/(\b(?:api_?key|authorization|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500) || "AI provider error";
}

export function classifyAIError(value: unknown): AIErrorDetails {
  const adminMessage = sanitizeAIErrorMessage(value);
  let code = "AI_AGENT_FAILED";
  if (adminMessage === "AI_CONFIGURATION_SNAPSHOT_LOST") code = "AI_CONFIGURATION_SNAPSHOT_LOST";
  else if (/未配置|api key|missing.*key|authentication.*provider/i.test(adminMessage)) code = "AI_NOT_CONFIGURED";
  else if (/timeout|timed out|超时|aborted/i.test(adminMessage)) code = "AI_TIMEOUT";
  else if (/429|rate.?limit|限流|too many requests/i.test(adminMessage)) code = "AI_RATE_LIMITED";
  else if (/network|fetch failed|econn|enotfound|socket|网络/i.test(adminMessage)) code = "AI_NETWORK_ERROR";
  else if (/provider|model|openai|response|status\s*[45]\d\d/i.test(adminMessage)) code = "AI_PROVIDER_ERROR";
  return { code, type: aiErrorTypeForCode(code), adminMessage, publicMessage: publicAIErrorMessage(code) };
}

export function publicAIErrorMessage(code?: string | null) {
  const messages: Record<string, string> = {
    AI_CONFIGURATION_SNAPSHOT_LOST: "服务重启后无法恢复原请求配置，请明确重试以使用当前配置。",
    AI_NOT_CONFIGURED: "AI 服务尚未完成配置，请稍后重试或联系管理员。",
    AI_TIMEOUT: "AI 服务响应超时，请稍后重试。",
    AI_RATE_LIMITED: "AI 请求较多，请稍后再试。",
    AI_NETWORK_ERROR: "AI 服务网络暂时不可用，请稍后重试。",
    AI_PROVIDER_ERROR: "AI 服务暂时不可用，请稍后重试。",
    AI_AGENT_FAILED: "AI 处理失败，请稍后重试。",
  };
  return messages[code || ""] || "AI 处理失败，请稍后重试。";
}

export function aiErrorTypeForCode(code?: string | null) {
  if (code === "AI_NOT_CONFIGURED" || code === "AI_CONFIGURATION_SNAPSHOT_LOST") return "configuration";
  if (code === "AI_TIMEOUT") return "timeout";
  if (code === "AI_RATE_LIMITED") return "rate_limit";
  if (code === "AI_NETWORK_ERROR") return "network";
  if (code === "AI_PROVIDER_ERROR") return "provider";
  return "server";
}
