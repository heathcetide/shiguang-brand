import { API_BASE } from "@/utils/config";

/** Stored local media paths stay relative until displayed by the client. */
export function resolveMediaUrl(url: string) {
  return url.startsWith("/media/") ? `${API_BASE.replace(/\/$/, "")}${url}` : url;
}
