export interface AgentSchedulingRepository {
  claimQueuedRuns(userId: number, maxRunning: number): Promise<string[]>;
  expireAwaitingApproval(runId: string, userId: number): Promise<number>;
  resetInterruptedRuns(): Promise<number>;
}
