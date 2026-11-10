import type { AgentActionProposal } from "../../services/agent/types.js";

export type ExecutableAgentAction = AgentActionProposal & { id?: string };

export type AgentActionExecution = {
  actionId?: string;
  result: unknown;
};

export interface AgentOperationsRepository {
  executeActions(userId: number, runId: string, proposals: ExecutableAgentAction[]): Promise<AgentActionExecution[]>;
  undoActions(userId: number, runId: string): Promise<{ undone: number }>;
}
