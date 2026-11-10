import { buildUserContext } from "../contextBuilder.js";
import { validateAgentActions } from "./policy.js";
import { agentOperationsService } from "../../modules/agentOperations/runtime.js";
import type { AgentActionProposal } from "./types.js";

export async function executeAgentActions(userId: number, runId: string, proposals: Array<AgentActionProposal & { id?: string }>) {
  const context = await buildUserContext(userId);
  validateAgentActions(proposals.map(({ actionType, summary, payload }) => ({ actionType, summary, payload })), context);
  return agentOperationsService().executeActions(userId, runId, proposals);
}

export function undoAgentRunActions(userId: number, runId: string) {
  return agentOperationsService().undoActions(userId, runId);
}
