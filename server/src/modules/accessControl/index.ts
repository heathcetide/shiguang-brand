import { AccessControlService } from "./service.js";

let configuredService: AccessControlService | undefined;

export function configureAccessControlService(service: AccessControlService) { configuredService = service; }
export function accessControlService() {
  if (!configuredService) throw new Error("ACCESS_CONTROL_SERVICE_NOT_CONFIGURED");
  return configuredService;
}

export const signUserToken = (userId: number) => accessControlService().signUserToken(userId);
export const ensureUserInitialState = (userId: number) => accessControlService().ensureUserInitialState(userId);
export const recordFunnelEvent = (userId: number, eventName: "account_registered" | "login_succeeded") =>
  accessControlService().recordFunnelEvent(userId, eventName);
export { AccessControlService } from "./service.js";
export type { SessionTokenClaims } from "./types.js";
