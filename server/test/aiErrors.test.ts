import assert from "node:assert/strict";
import test from "node:test";

import { aiErrorTypeForCode, classifyAIError, publicAIErrorMessage, sanitizeAIErrorMessage } from "../src/services/aiErrors.js";

test("AI failures are classified into stable diagnostic categories", () => {
  const cases = [
    ["AI Agent 尚未配置聊天模型 API Key", "AI_NOT_CONFIGURED", "configuration", "AI 服务尚未完成配置，请稍后重试或联系管理员。"],
    ["provider request timed out", "AI_TIMEOUT", "timeout", "AI 服务响应超时，请稍后重试。"],
    ["provider 429 rate limit exceeded", "AI_RATE_LIMITED", "rate_limit", "AI 请求较多，请稍后再试。"],
    ["provider fetch failed: ECONNRESET", "AI_NETWORK_ERROR", "network", "AI 服务网络暂时不可用，请稍后重试。"],
    ["provider returned status 500", "AI_PROVIDER_ERROR", "provider", "AI 服务暂时不可用，请稍后重试。"],
    ["Unexpected failure", "AI_AGENT_FAILED", "server", "AI 处理失败，请稍后重试。"],
  ];
  for (const [message, code, type, publicMessage] of cases) {
    assert.deepEqual(classifyAIError(new Error(message)), { code, type, adminMessage: message, publicMessage });
    assert.equal(aiErrorTypeForCode(code), type);
    assert.equal(publicAIErrorMessage(code), publicMessage);
  }
  for (const code of [undefined, null, "", "UNKNOWN"]) {
    assert.equal(aiErrorTypeForCode(code), "server");
    assert.equal(publicAIErrorMessage(code), "AI 处理失败，请稍后重试。");
  }
});

test("AI diagnostic messages redact credentials before persistence or admin display", () => {
  const message = sanitizeAIErrorMessage(
    "request failed Authorization='Bearer secret-token-value' api_key=sk-supersecret123456789 token=my-token",
  );
  assert.doesNotMatch(message, /secret-token-value|supersecret|my-token/);
  assert.match(message, /REDACTED/);
});
