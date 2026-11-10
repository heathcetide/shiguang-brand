export type AIProviderConfig = { apiKey: string; baseUrl: string; model: string };
export type AIConfig = AIProviderConfig & {
  visionModel: string;
  asrModel: string;
  chat: AIProviderConfig;
  vision: AIProviderConfig;
  asr: AIProviderConfig;
};

export type AIUsageInput = {
  userId: number;
  endpoint: string;
  model: string;
  runId?: string;
  agentName?: string;
  phase?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  success?: boolean;
  estimatedCostUsd?: number;
  failureReason?: string;
};

export type AIUsageWrite = Required<Pick<AIUsageInput,
  "userId" | "endpoint" | "model" | "promptTokens" | "completionTokens" | "totalTokens" | "latencyMs" | "success" | "estimatedCostUsd">>
  & Pick<AIUsageInput, "runId" | "agentName" | "phase" | "failureReason">;
