import { createHmac } from "node:crypto";
import { JWT_SECRET } from "../config/security.js";

export type FunnelEventName = "account_registered" | "login_succeeded" | "inventory_added" | "cooking_completed";
export type FunnelEventWriter = (eventName: FunnelEventName, actorHash: string) => Promise<void> | void;

export function actorHashFor(userId: number) {
  return createHmac("sha256", JWT_SECRET).update(`user:${userId}`).digest("hex");
}

export async function recordFunnelEvent(userId: number, eventName: FunnelEventName, write: FunnelEventWriter) {
  // Only a keyed, one-way pseudonym is stored. No food, health, message, IP or login identifier is attached.
  try {
    await write(eventName, actorHashFor(userId));
  } catch (error) {
    console.warn("[Funnel Event Error]", error instanceof Error ? error.message : String(error));
  }
}
