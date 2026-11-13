import type { ApiFetch } from "@/services/api/client";
import type {
  AgentHarnessResult,
  AgentHarnessStep,
  AgentToolCall,
  AgentToolDefinition,
  AgentToolResult,
} from "./types";

// Lazy tools import keeps pure planner helpers free of React Native module graphs in unit tests.
function loadDefaultTools(): AgentToolDefinition[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("./tools") as typeof import("./tools")).agentTools;
}

function loadToolCatalogPrompt(tools: AgentToolDefinition[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("./tools") as typeof import("./tools")).toolCatalogPrompt(tools);
}

export type AgentCompleteFn = (input: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  toolContext?: string;
}) => Promise<{ reply: string; runId?: string; raw?: unknown }>;

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function scoreTool(tool: AgentToolDefinition, text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const hint of tool.hints ?? []) {
    if (hint && lower.includes(hint.toLowerCase())) score += 2;
  }
  if (lower.includes(tool.name.replaceAll("_", ""))) score += 1;
  return score;
}

/** Local planner: pick the most relevant tools for the user utterance. */
export function planTools(goal: string, tools?: AgentToolDefinition[], limit = 3): AgentToolDefinition[] {
  const catalog = tools ?? loadDefaultTools();
  return planToolsAgainst(goal, catalog, limit);
}

function planToolsAgainst(goal: string, tools: AgentToolDefinition[], limit = 3): AgentToolDefinition[] {
  const scored = tools
    .map((tool) => ({ tool, score: scoreTool(tool, goal) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    // Always gather inventory + health for cooking advice when no keyword matched.
    return tools.filter((tool) => tool.name === "list_inventory" || tool.name === "get_health_profile").slice(0, 2);
  }
  return scored.slice(0, limit).map((entry) => entry.tool);
}

async function executeTool(
  tool: AgentToolDefinition,
  args: Record<string, unknown>,
  apiFetch: ApiFetch,
  userId?: number | string | null,
): Promise<AgentToolResult> {
  const id = newId("tool");
  try {
    const result = await tool.execute(args, { apiFetch, userId });
    return { id, name: tool.name, ok: true, result };
  } catch (error) {
    return {
      id,
      name: tool.name,
      ok: false,
      error: error instanceof Error ? error.message : "工具执行失败",
    };
  }
}

export function formatToolContext(results: AgentToolResult[]): string {
  if (!results.length) return "";
  return results
    .map((item) => {
      if (!item.ok) return `[tool:${item.name}] ERROR ${item.error}`;
      return `[tool:${item.name}] ${JSON.stringify(item.result)}`;
    })
    .join("\n");
}

export type RunAgentHarnessOptions = {
  goal: string;
  apiFetch: ApiFetch;
  userId?: number | string | null;
  tools?: AgentToolDefinition[];
  maxTools?: number;
  complete: AgentCompleteFn;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Extra tool calls forced by the UI (e.g. vision path already ran). */
  extraCalls?: AgentToolCall[];
};

/**
 * Harness-level agent loop (TypeScript):
 * 1) plan tools from the user goal
 * 2) execute tools against backend APIs
 * 3) call the model with a structured tool context block
 *
 * The model itself still lives on the Go gateway; the client owns tool selection/execution.
 */
export async function runAgentHarness(options: RunAgentHarnessOptions): Promise<AgentHarnessResult> {
  const tools = options.tools ?? loadDefaultTools();
  const steps: AgentHarnessStep[] = [];
  const selected = planToolsAgainst(options.goal, tools, options.maxTools ?? 3);
  steps.push({
    type: "plan",
    tools: selected.map((tool) => tool.name),
    reason: `matched ${selected.length} tools for goal`,
  });

  const toolResults: AgentToolResult[] = [];
  for (const tool of selected) {
    const call: AgentToolCall = { id: newId("call"), name: tool.name, arguments: { query: options.goal } };
    steps.push({ type: "tool_call", call });
    const result = await executeTool(tool, call.arguments, options.apiFetch, options.userId);
    toolResults.push(result);
    steps.push({ type: "tool_result", result });
  }

  for (const call of options.extraCalls ?? []) {
    const tool = tools.find((item) => item.name === call.name);
    if (!tool) continue;
    steps.push({ type: "tool_call", call });
    const result = await executeTool(tool, call.arguments, options.apiFetch, options.userId);
    toolResults.push(result);
    steps.push({ type: "tool_result", result });
  }

  const contextBlock = formatToolContext(toolResults);
  const system = [
    "你是「拾味助手」。下面是客户端 harness 已执行的只读工具结果，请优先依据它们回答；不要假装调用了未提供的工具。",
    "可用工具目录：",
    loadToolCatalogPrompt(tools),
    contextBlock ? `工具结果：\n${contextBlock}` : "本次未取得额外工具数据。",
  ].join("\n\n");

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    ...(options.history ?? []).slice(-12),
    { role: "user", content: options.goal },
  ];
  steps.push({ type: "message", role: "user", content: options.goal });

  const completed = await options.complete({ messages, toolContext: contextBlock });
  steps.push({ type: "message", role: "assistant", content: completed.reply });

  return {
    reply: completed.reply,
    steps,
    toolResults,
    contextBlock,
    runId: completed.runId,
    raw: completed.raw,
  };
}

// Tool catalog lives in ./tools — re-export only via index.ts to avoid Metro
// "Export 'agentTools' is not defined" when this file re-exports unbound names.
