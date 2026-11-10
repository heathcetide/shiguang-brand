import assert from "node:assert/strict";
import type Database from "better-sqlite3";

type Api = (path:string,options?:RequestInit & {token?:string}) => Promise<{response:Response;body:unknown}>;
export async function verifyAccountSecurityHttp(api: Api, db: Database.Database) {
  const request = async (path: string, body: unknown, token?: string, method = "POST") => {
    const result = await api(`/api/v1/auth${path}`, {method, body: JSON.stringify(body), token});
    return {status: result.response.status, body: result.body as Record<string,any>};
  };
  const email = "password-security@example.test";
  const registration = await request("/register", {identifier: email, username: "password-security", password: "InitialPass123"});
  assert.equal(registration.status, 201);
  const id = Number(registration.body.user.id);
  const originalToken = registration.body.token as string;
  assert.equal((await request("/account", {password:"wrong", confirmation:"DELETE"}, originalToken, "DELETE")).status, 400);
  assert.ok(db.prepare("SELECT id FROM users WHERE id=?").get(id));
  assert.equal((await request("/change-password", {currentPassword:"wrong",newPassword:"ChangedPass123"},originalToken)).status,400);
  assert.equal((await request("/change-password", {currentPassword:"InitialPass123",newPassword:"ChangedPass123"},originalToken)).status,200);
  assert.equal((await api("/api/v1/auth/me",{token:originalToken})).response.status,401);
  assert.equal((await request("/login",{identifier:email,password:"InitialPass123"})).status,401);
  const login=await request("/login",{identifier:email,password:"ChangedPass123"});
  assert.equal(login.status,200);
  assert.equal((await request("/account",{password:"ChangedPass123",confirmation:"DELETE"},login.body.token,"DELETE")).status,200);
  assert.equal(db.prepare("SELECT id FROM users WHERE id=?").get(id),undefined);
}
