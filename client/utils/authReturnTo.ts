export type AuthReturnTo = {
  pathname: "/" | "/recipe-detail" | "/post-detail" | "/user-profile" | "/cooking-mode" | "/cooking-queue" | "/inventory" | "/favorites" | "/shopping-list" | "/recipe-submit" | "/post-create" | "/feedback" | "/diet-record" | "/cooking-plan" | "/health-profile" | "/profile-settings";
  params?: Record<string, string | number>;
};

const POSITIVE_ID_PATHS = new Set(["/recipe-detail", "/post-detail", "/user-profile", "/cooking-mode"]);
const PARAMETERLESS_PATHS = new Set(["/", "/favorites", "/shopping-list", "/recipe-submit", "/cooking-queue", "/profile-settings"]);
const POST_DETAIL_ACTIONS = new Set(["like", "follow", "join", "comment", "comment-like", "collect"]);

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateAuthReturnTo(value: unknown): AuthReturnTo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { pathname?: unknown; params?: unknown };
  if (typeof candidate.pathname !== "string" || !candidate.pathname.startsWith("/")) return null;

  if (PARAMETERLESS_PATHS.has(candidate.pathname)) {
    return { pathname: candidate.pathname as AuthReturnTo["pathname"] };
  }
  const params = candidate.params && typeof candidate.params === "object" && !Array.isArray(candidate.params)
    ? candidate.params as Record<string, unknown>
    : {};
  if (POSITIVE_ID_PATHS.has(candidate.pathname)) {
    const key = candidate.pathname === "/cooking-mode"
      ? "recipeId"
      : candidate.pathname === "/user-profile"
        ? "userId"
        : "id";
    const id = positiveInteger(params[key]);
    if (!id) return null;
    const safeParams: Record<string, string | number> = { [key]: id };
    if (candidate.pathname === "/recipe-detail" && ["favorite", "shopping-list", "queue"].includes(String(params.pendingAction))) {
      safeParams.pendingAction = String(params.pendingAction);
    }
    if (candidate.pathname === "/post-detail" && POST_DETAIL_ACTIONS.has(String(params.pendingAction))) {
      safeParams.pendingAction = String(params.pendingAction);
      if (params.pendingAction === "comment-like") {
        const commentId = positiveInteger(params.commentId);
        if (commentId) safeParams.commentId = commentId;
      }
    }
    if (candidate.pathname === "/user-profile" && params.pendingAction === "follow") {
      safeParams.pendingAction = "follow";
    }
    return { pathname: candidate.pathname as AuthReturnTo["pathname"], params: safeParams };
  }
  if (candidate.pathname === "/health-profile") {
    return ["body", "nutrition", "safety", "kitchen"].includes(String(params.section))
      ? { pathname: "/health-profile", params: { section: String(params.section) } }
      : { pathname: "/health-profile" };
  }
  if (candidate.pathname === "/cooking-plan") {
    const planId = typeof params.planId === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(params.planId) ? params.planId : null;
    return planId ? { pathname: "/cooking-plan", params: { planId } } : { pathname: "/cooking-plan" };
  }
  if (candidate.pathname === "/inventory" || candidate.pathname === "/diet-record") {
    return params.action === "add"
      ? { pathname: candidate.pathname, params: { action: "add" } }
      : { pathname: candidate.pathname };
  }
  if (candidate.pathname === "/post-create") {
    return ["寻味", "榜单", "活动", "问答"].includes(String(params.category))
      ? { pathname: "/post-create", params: { category: String(params.category) } }
      : { pathname: "/post-create" };
  }
  if (candidate.pathname === "/feedback") {
    const safeParams: Record<string, string | number> = {};
    if (["bug", "suggestion", "content", "support"].includes(String(params.category))) {
      safeParams.category = String(params.category);
    }
    if (typeof params.page === "string" && params.page.length <= 80) safeParams.page = params.page;
    return Object.keys(safeParams).length
      ? { pathname: "/feedback", params: safeParams }
      : { pathname: "/feedback" };
  }
  return null;
}

export function createAuthReturnTo(pathname: string, params: Record<string, unknown> = {}) {
  return validateAuthReturnTo({ pathname, params });
}
