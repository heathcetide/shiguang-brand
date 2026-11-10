export function parseUtcDatabaseDate(value?: string | null) {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized);
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDateTime(value?: string | null, timeZone?: string) {
  const date = parseUtcDatabaseDate(value);
  if (!date) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatLocalPostDate(value?: string | null) {
  const date = parseUtcDatabaseDate(value);
  if (!date) return "长期开放";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
