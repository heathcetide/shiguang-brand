import type { ApiFetch } from "@/services/api/client";

export type AgentToolParameter = {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: string[];
  optional?: boolean;
  items?: { type: "string" | "number" | "boolean" | "object" };
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, AgentToolParameter>;
  /** Soft keyword hints used by the local planner when the model does not emit tool_calls. */
  hints?: string[];
  execute: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<unknown>;
};

export type AgentToolContext = {
  apiFetch: ApiFetch;
  userId?: number | string | null;
};

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentToolResult = {
  id: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type AgentHarnessStep =
  | { type: "plan"; tools: string[]; reason: string }
  | { type: "tool_call"; call: AgentToolCall }
  | { type: "tool_result"; result: AgentToolResult }
  | { type: "message"; role: "assistant" | "user" | "system"; content: string };

export type AgentHarnessResult = {
  reply: string;
  steps: AgentHarnessStep[];
  toolResults: AgentToolResult[];
  contextBlock: string;
  runId?: string;
  raw?: unknown;
};
