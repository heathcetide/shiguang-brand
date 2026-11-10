import { notificationsService } from "../modules/notifications/runtime.js";
import type { PushMessage } from "../modules/notifications/types.js";

export function sendExpoPush(messages: PushMessage[]) {
  return notificationsService().sendExpoPush(messages);
}

export function checkExpoPushReceipts() {
  return notificationsService().checkExpoPushReceipts();
}

export function sendExpiringInventoryNotifications() {
  return notificationsService().sendExpiringInventoryNotifications();
}

export function sendInterventions(context: import("../modules/worker/types.js").WorkerTaskContext) {
  return notificationsService().sendInterventions(context);
}

export function scanInterventions(context: import("../modules/worker/types.js").WorkerTaskContext) {
  return notificationsService().scanInterventions(context);
}
