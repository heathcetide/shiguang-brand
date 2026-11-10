export type AdminSessionFailure = "unauthenticated" | "insufficient-role" | null;

export function classifyAdminSession(input: { status?: number; code?: string; role?: string }): AdminSessionFailure {
  if (input.status === 401) return "unauthenticated";
  if (input.role !== undefined && input.role !== "admin") return "insufficient-role";
  if (input.status === 403 && input.code === "ADMIN_ROLE_REQUIRED") return "insufficient-role";
  return null;
}

export function adminLoginPath(reason: Exclude<AdminSessionFailure, null>) {
  return `/login?reason=${reason}`;
}
