import { describe, expect, it } from "vitest";
import { adminLoginPath, classifyAdminSession } from "./adminSession";

describe("admin session classification", () => {
  it("invalidates a token after the user loses the admin role", () => {
    expect(classifyAdminSession({ role: "user" })).toBe("insufficient-role");
    expect(classifyAdminSession({ status: 403, code: "ADMIN_ROLE_REQUIRED" })).toBe("insufficient-role");
    expect(adminLoginPath("insufficient-role")).toBe("/login?reason=insufficient-role");
  });

  it("does not treat an unrelated permission failure as session loss", () => {
    expect(classifyAdminSession({ status: 403, code: "RESOURCE_FORBIDDEN" })).toBeNull();
    expect(classifyAdminSession({ role: "admin" })).toBeNull();
  });
});
