import type { AuthVerificationService } from "./service.js";

let configuredService: AuthVerificationService | null = null;
export function configureAuthVerificationService(service: AuthVerificationService) { configuredService = service; }
export function authVerificationService() {
  if (!configuredService) throw new Error("AUTH_VERIFICATION_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
