import { RateLimitsService } from "./service.js";

let configuredService: RateLimitsService | undefined;

export function configureRateLimitsService(service: RateLimitsService) { configuredService = service; }
export function rateLimitsService() {
  if (!configuredService) throw new Error("RATE_LIMITS_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
export { hashRateLimitKey } from "./service.js";
export { RateLimitsService } from "./service.js";
