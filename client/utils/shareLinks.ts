export const SHARE_CODE_PATTERN = /(?:分享码[：:]?\s*)?SG([A-F0-9]{10})/i;

export function parseSharedPostUrl(url: string) {
  try {
    const parsed = new URL(url);
    const isPostDetail = /\/post-detail\/?$/.test(parsed.pathname)
      || (parsed.protocol === "dietdigidose:" && parsed.hostname === "post-detail");
    const id = Number(parsed.searchParams.get("id"));
    return isPostDetail && Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function parseShareCode(content: string) {
  return SHARE_CODE_PATTERN.exec(content)?.[1]?.toUpperCase() || null;
}
