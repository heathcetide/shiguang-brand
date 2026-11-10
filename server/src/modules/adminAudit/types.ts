export type AdminAuditEvent = {
  adminUserId: number;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  summary: string;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};
