export type Row = Record<string, unknown>;

export type LoginIdentifier = { email: string | null; phone: string | null };

export type RegistrationInput = LoginIdentifier & {
  username: string;
  passwordHash: string;
};

export type RegistrationResult =
  | { status: "created"; user: Row; sessionVersion: number }
  | { status: "identifier_exists" }
  | { status: "username_exists" };

export type LoginUser = Row & {
  id: number;
  username: string;
  password_hash: string | null;
  role: string;
  session_version: number;
  is_disabled: number | boolean;
};

export type AccountCredentials = {
  username?: string;
  role: string;
  password_hash: string | null;
};

export type ProfileInput = {
  username?: string;
  avatar_url?: string;
  bio?: string;
  daily_calories_target?: number;
};

export type ProfileResult = { status: "updated"; user: Row } | { status: "username_exists" };

export type AiDataExport = {
  messages: Row[];
  scan_jobs: Row[];
  agent_runs: Row[];
  agent_events: Row[];
  agent_actions: Row[];
  agent_media_references: Row[];
  agent_checkpoints: Row[];
  agent_checkpoint_blobs: Row[];
  agent_checkpoint_writes: Row[];
};

export type AiDataDeletion = {
  messages: number;
  scan_jobs: number;
  usage_logs: number;
  write_confirmations: number;
  chat_session_deletions: number;
  agent_runs: number;
};

export type AdminAudit = {
  adminUserId: number;
  action: string;
  resourceType: string;
  resourceId: number;
  summary: string;
  ipAddress?: string;
  userAgent?: string;
};

export type AccountDeletionResult = { deleted: boolean; cleanupJobId: number | null };
