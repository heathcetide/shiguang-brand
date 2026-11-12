// Validate API data before it enters page state. The Go and Express runtimes
// currently expose different list envelopes; an unknown shape is not an empty list.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coerce Express/Go list envelopes into a stable array for admin page state. */
export function asAdminArray<T = unknown>(value: unknown, keys: string[] = ['items']): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate as T[];
  }
  return [];
}

export function asAdminPage<T = unknown>(value: unknown, keys: string[] = ['items']) {
  const items = asAdminArray<T>(value, keys);
  const record = isRecord(value) ? value : {};
  const next = record.nextCursor;
  return {
    items,
    total: typeof record.total === 'number' && Number.isFinite(record.total) ? record.total : items.length,
    nextCursor: typeof next === 'string' || typeof next === 'number' ? next : null,
    summary: isRecord(record.summary) ? record.summary : undefined,
    raw: record,
  };
}

export interface AdminUser {
  id: number;
  username: string;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string;
  role: string;
  is_verified_expert?: number | boolean;
  is_disabled?: number | boolean;
  created_at: string;
  has_health_profile?: number | boolean;
  level?: { level: number; title: string; xp: number; baseXp: number; adjustmentXp: number; progress: number };
}

function isUser(value: unknown): value is AdminUser {
  return isRecord(value)
    && Number.isInteger(value.id)
    && typeof value.username === 'string'
    && typeof value.role === 'string'
    && typeof value.created_at === 'string'
    && (value.email == null || typeof value.email === 'string')
    && (value.phone == null || typeof value.phone === 'string')
    && (value.avatar_url == null || typeof value.avatar_url === 'string');
}

export function parseAdminUsers(value: unknown): { items: AdminUser[]; nextCursor: string | null; total: number; page: number; pageSize: number } {
  if (!isRecord(value)) throw new Error('用户列表响应格式不正确');
  // Prefer the paginated contract when present; don't mask a broken items field.
  const items = 'items' in value ? value.items : value.users;
  if (!Array.isArray(items) || !items.every(isUser)
    || (value.nextCursor != null && typeof value.nextCursor !== 'string')) {
    throw new Error('用户列表响应格式不正确');
  }
  const total = typeof value.total === 'number' && Number.isFinite(value.total) ? value.total : items.length;
  const page = typeof value.page === 'number' && Number.isFinite(value.page) ? value.page : 1;
  const pageSize = typeof value.pageSize === 'number' && Number.isFinite(value.pageSize) ? value.pageSize : items.length || 50;
  return {
    items,
    nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null,
    total,
    page,
    pageSize,
  };
}

type Campaign = { id: number; title: string; body: string; status: string; recipientCount?: number; successCount?: number; failureCount?: number; createdAt: string; sentAt?: string | null; adminName?: string };
type Automatic = { deliveryDate: string; status: string; count: number };
type NotificationMetrics = Partial<Record<'created' | 'pushSubmitted' | 'pushDelivered' | 'opened' | 'actionClicks' | 'pushFailures', number>>;
export type NotificationOverview = {
  interventionsEnabled?: boolean;
  interventionMetrics?: Record<string, number>;
  activeDevices?: number;
  enabledUsers?: number;
  campaigns?: Campaign[];
  automatic?: Automatic[];
  metrics?: NotificationMetrics;
};
const metricKeys = ['created', 'pushSubmitted', 'pushDelivered', 'opened', 'actionClicks', 'pushFailures'] as const;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const optionalCount = (value: unknown) => value === undefined || isCount(value);
function isCampaign(value: unknown): value is Campaign {
  return isRecord(value) && Number.isInteger(value.id)
    && ['title', 'body', 'status', 'createdAt'].every(key => typeof value[key] === 'string')
    && ['recipientCount', 'successCount', 'failureCount'].every(key => optionalCount(value[key]))
    && (value.adminName === undefined || typeof value.adminName === 'string')
    && (value.sentAt == null || typeof value.sentAt === 'string');
}
function isAutomatic(value: unknown): value is Automatic {
  return isRecord(value) && typeof value.deliveryDate === 'string'
    && typeof value.status === 'string' && isCount(value.count);
}

export function parseNotificationOverview(value: unknown): NotificationOverview {
  if (!isRecord(value) || !['campaigns', 'notifications', 'metrics', 'automatic'].some(key => key in value)) {
    throw new Error('通知数据响应格式不正确，请重试或联系管理员');
  }
  if (!optionalCount(value.activeDevices) || !optionalCount(value.enabledUsers)
    || (value.interventionsEnabled !== undefined && typeof value.interventionsEnabled !== 'boolean')
    || (value.campaigns !== undefined && (!Array.isArray(value.campaigns) || !value.campaigns.every(isCampaign)))
    || (value.automatic !== undefined && (!Array.isArray(value.automatic) || !value.automatic.every(isAutomatic)))
    || (value.notifications !== undefined && !Array.isArray(value.notifications))
    || (value.metrics !== undefined && (!isRecord(value.metrics) || !metricKeys.every(key => optionalCount((value.metrics as Record<string, unknown>)[key]))))
    || (value.interventionMetrics !== undefined && (!isRecord(value.interventionMetrics) || !Object.values(value.interventionMetrics).every(isCount)))) {
    throw new Error('通知数据响应格式不正确，请重试或联系管理员');
  }
  // notifications may contain per-user inbox entries, not campaigns. Never relabel them.
  return value as NotificationOverview;
}

export function hasCompleteNotificationOverview(data: NotificationOverview): boolean {
  return isCount(data.activeDevices) && isCount(data.enabledUsers)
    && data.campaigns !== undefined && data.automatic !== undefined
    && metricKeys.every(key => isCount(data.metrics?.[key]));
}
