import type {
  AdminAudit, AuditQuery, ConversationData, Row, RunDiagnostic, ScanQuery, TrashResource, UsageData, UsageQuery,
} from "./types.js";

export interface AdminConsoleRepository {
  coreLoopSettings(): Promise<Row>;
  updateCoreLoopSettings(enabled: boolean, version: number, environment: string | null, audit: AdminAudit): Promise<boolean>;
  coreLoopActor(userId: number): Promise<Row | null>;
  updateCoreLoopActor(userId: number, kind: string, version: number, audit: AdminAudit): Promise<boolean>;
  coreLoopData(start: string, end: string): Promise<import("./coreLoopProjection.js").CoreLoopDataset>;
  stats(): Promise<Row>;
  funnel(days: number): Promise<Row[]>;
  auditLogs(input: AuditQuery): Promise<{ items: Row[]; total: number }>;
  scanJobs(input: ScanQuery): Promise<Row[]>;
  scanJob(id: string): Promise<Row | null>;
  conversations(query?: string): Promise<Row[]>;
  conversation(userId: number, sessionId: string): Promise<ConversationData>;
  runDiagnostic(userId: number, runId: string): Promise<RunDiagnostic>;
  trash(): Promise<Record<TrashResource, Row[]>>;
  restore(resource: TrashResource, id: number, audit: AdminAudit): Promise<boolean>;
  userExists(userId: number): Promise<boolean>;
  usage(input: UsageQuery): Promise<UsageData>;
  trends(days: number): Promise<Row[]>;
  recent(): Promise<{ recentUsers: Row[]; recentPosts: Row[]; pendingFoods: Row[] }>;
}
