import type { RecommendationsService } from "./service.js";

let configuredService: RecommendationsService | undefined;

export function configureRecommendationsService(service: RecommendationsService) { configuredService = service; }

export function recommendationsService() {
  if (!configuredService) throw new Error("Recommendations service has not been configured");
  return configuredService;
}
