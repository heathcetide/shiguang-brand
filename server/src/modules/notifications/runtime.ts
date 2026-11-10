import type { NotificationsService } from "./service.js";

let configuredService: NotificationsService | null = null;

export function configureNotificationsService(service: NotificationsService) { configuredService = service; }
export function notificationsService() {
  if (!configuredService) throw new Error("NOTIFICATIONS_SERVICE_NOT_CONFIGURED");
  return configuredService;
}
