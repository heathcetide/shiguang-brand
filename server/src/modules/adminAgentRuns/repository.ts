import type { AgentRunDetailData, AgentRunListData, AgentRunListQuery } from "./types.js";

export interface AdminAgentRunsRepository {
  list(input: AgentRunListQuery): Promise<AgentRunListData>;
  detail(runId: string): Promise<AgentRunDetailData | null>;
}
