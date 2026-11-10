import type { StoredAccessUser } from "./types.js";
import type { FunnelEventName } from "../../services/funnelEvents.js";

export interface AccessControlRepository {
  user(userId: number): Promise<StoredAccessUser | null>;
  ensureUserInitialState(userId: number): Promise<void>;
  recordFunnelEvent(eventName: FunnelEventName, actorHash: string): Promise<void>;
}
