import { createAuthReturnTo, validateAuthReturnTo } from "./authReturnTo";

describe("login returnTo allowlist", () => {
  it("returns new users to the original task with only supported conditions", () => {
    expect(createAuthReturnTo("/diet-record", { action: "add", calories: 900 }))
      .toEqual({ pathname: "/diet-record", params: { action: "add" } });
    expect(createAuthReturnTo("/health-profile", { section: "nutrition", weight: 60 }))
      .toEqual({ pathname: "/health-profile", params: { section: "nutrition" } });
    expect(createAuthReturnTo("/cooking-plan", { planId: "00000000-0000-4000-8000-000000000001" }))
      .toEqual({ pathname: "/cooking-plan", params: { planId: "00000000-0000-4000-8000-000000000001" } });
  });
  it("accepts the core internal continuation routes", () => {
    expect(createAuthReturnTo("/cooking-mode", { recipeId: 12 })).toEqual({
      pathname: "/cooking-mode",
      params: { recipeId: 12 },
    });
    expect(createAuthReturnTo("/inventory", { action: "add", ignored: "value" })).toEqual({
      pathname: "/inventory",
      params: { action: "add" },
    });
    expect(createAuthReturnTo("/cooking-queue", { ignored: "value" })).toEqual({
      pathname: "/cooking-queue",
    });
  });

  it("rejects external, login and malformed destinations", () => {
    expect(validateAuthReturnTo("https://evil.example")).toBeNull();
    expect(validateAuthReturnTo({ pathname: "https://evil.example" })).toBeNull();
    expect(validateAuthReturnTo({ pathname: "/login" })).toBeNull();
    expect(validateAuthReturnTo({ pathname: "/cooking-mode", params: { recipeId: "nope" } })).toBeNull();
  });

  it("drops unknown parameters from an allowed destination", () => {
    expect(validateAuthReturnTo({
      pathname: "/recipe-detail",
      params: { id: 8, pendingAction: "favorite", redirect: "https://evil.example" },
    })).toEqual({ pathname: "/recipe-detail", params: { id: 8, pendingAction: "favorite" } });
    expect(validateAuthReturnTo({ pathname: "/recipe-detail", params: { id: 8, pendingAction: "queue" } }))
      .toEqual({ pathname: "/recipe-detail", params: { id: 8, pendingAction: "queue" } });
  });

  it("preserves a post and a supported action without accepting arbitrary parameters", () => {
    expect(validateAuthReturnTo({
      pathname: "/post-detail",
      params: { id: "42", pendingAction: "comment-like", commentId: 7, draft: "private text" },
    })).toEqual({
      pathname: "/post-detail",
      params: { id: 42, pendingAction: "comment-like", commentId: 7 },
    });
    expect(validateAuthReturnTo({
      pathname: "/post-detail",
      params: { id: 42, pendingAction: "delete" },
    })).toEqual({ pathname: "/post-detail", params: { id: 42 } });
  });

  it("allows guarded creation and profile destinations with constrained context", () => {
    expect(createAuthReturnTo("/post-create", { category: "活动", redirect: "https://evil.example" }))
      .toEqual({ pathname: "/post-create", params: { category: "活动" } });
    expect(createAuthReturnTo("/user-profile", { userId: 9, pendingAction: "follow" }))
      .toEqual({ pathname: "/user-profile", params: { userId: 9, pendingAction: "follow" } });
  });
});
