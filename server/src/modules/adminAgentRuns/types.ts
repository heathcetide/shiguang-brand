export type Row = Record<string, unknown>;

export type AgentRunListQuery = {
  page: number;
  pageSize: number;
  status?: string;
  modality?: string;
  agent?: string;
  search?: string;
  rangeDays: number | null;
};

export type AgentRunListData = {
  rows: Row[];
  total: number;
  statusCounts: Row[];
  usageSummary: Row;
};

export type AgentRunDetailData = {
  run: Row;
  checkpointAvailable: boolean;
  checkpointCount: number;
  checkpointWriteCount: number;
  events: Row[];
  actions: Row[];
  usageSummary: Row;
  usageByAgent: Row[];
  usageRecords: Row[];
};

export type PublicCheckpointState = {
  goal: string | null;
  specialists: string[];
  outputs: Record<string, unknown>;
  artifactCount: number;
} | null;
