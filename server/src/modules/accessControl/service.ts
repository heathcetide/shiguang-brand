import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../config/security.js";
import { recordFunnelEvent, type FunnelEventName } from "../../services/funnelEvents.js";
import type { AccessControlRepository } from "./repository.js";
import type { AccessUser } from "./types.js";

function storedBoolean(value: unknown) {
  return value === true || value === 1 || value === "1";
}

export class AccessControlService {
  private readonly repository: AccessControlRepository;

  constructor(repository: AccessControlRepository) { this.repository = repository; }

  async user(userId: number): Promise<AccessUser | null> {
    const user = await this.repository.user(userId);
    if (!user) return null;
    return {
      sessionVersion: Math.max(1, Number(user.sessionVersion) || 1),
      isDisabled: storedBoolean(user.isDisabled),
      role: String(user.role || "user"),
      mustChangePassword: storedBoolean(user.mustChangePassword),
    };
  }

  async signUserToken(userId: number) {
    const user = await this.user(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    return jwt.sign({ userId, sessionVersion: user.sessionVersion }, JWT_SECRET, { expiresIn: "30d" });
  }

  ensureUserInitialState(userId: number) {
    if (!Number.isInteger(userId) || userId <= 0) throw new Error("INVALID_USER_ID");
    return this.repository.ensureUserInitialState(userId);
  }

  recordFunnelEvent(userId: number, eventName: FunnelEventName) {
    return recordFunnelEvent(userId, eventName,
      (name, actorHash) => this.repository.recordFunnelEvent(name, actorHash));
  }
}
