export type AdminSessionFailure = "unauthenticated" | "insufficient-role" | null;

/** Local preference: allow skipping the forced first-login password change until password is updated. */
export const ADMIN_PASSWORD_CHANGE_DEFERRED_KEY = "adminPasswordChangeDeferred";

export function classifyAdminSession(input: { status?: number; code?: string; role?: string }): AdminSessionFailure {
  if (input.status === 401) return "unauthenticated";
  if (input.role !== undefined && input.role !== "admin") return "insufficient-role";
  if (input.status === 403 && input.code === "ADMIN_ROLE_REQUIRED") return "insufficient-role";
  return null;
}

export function adminLoginPath(reason: Exclude<AdminSessionFailure, null>) {
  return `/login?reason=${reason}`;
}

export function shouldForceAdminPasswordChange(mustChangePassword: unknown) {
  if (!mustChangePassword) return false;
  return localStorage.getItem(ADMIN_PASSWORD_CHANGE_DEFERRED_KEY) !== "1";
}
