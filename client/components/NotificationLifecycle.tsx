import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { authApi } from "@/services/api";
import {
  type AppNotificationData,
  getExpiringNotificationAction,
  resolveNotificationDestination,
} from "@/utils/notificationResponse";

const LAST_HANDLED_NOTIFICATION_RESPONSE_KEY = "@last_handled_notification_response";

export function NotificationLifecycle() {
  const { token, user } = useAuth();
  const router = useSafeRouter();

  useEffect(() => {
    if (Platform.OS === "web" || !token) return;

    const recordRoutine = (notification: Notifications.Notification, event: "received" | "opened") => {
      const data = notification.request.content.data as AppNotificationData;
      if (data.type !== "routine_reminder" || (data.kind !== "meal" && data.kind !== "water")) return;
      void authApi.recordLocalNotificationEvent(token, {
        kind: data.kind,
        title: notification.request.content.title || (data.kind === "meal" ? "用餐提醒" : "饮水提醒"),
        body: notification.request.content.body || "按计划完成今天的健康习惯。",
        event,
        source_id: data.sourceId,
      }).catch(() => undefined);
    };

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const notification = response.notification;
      const data = notification.request.content.data as AppNotificationData;
      if (data.type === "cooking_reminder" && data.userId !== user?.id) return;
      recordRoutine(notification, "opened");
      if (data.type === "expiring_inventory" && typeof data.notificationId === "number") {
        const action = getExpiringNotificationAction(response.actionIdentifier);
        void authApi.notificationAction(token, data.notificationId, action).catch(() => undefined);
      }

      const destination = resolveNotificationDestination(data, response.actionIdentifier);
      if (destination) router.push(destination);
    };

    const handledInSession = new Set<string>();
    const consumeResponse = async (response: Notifications.NotificationResponse) => {
      const responseKey = [
        response.notification.request.identifier,
        response.notification.date,
        response.actionIdentifier,
      ].join(":");
      if (handledInSession.has(responseKey)) return;
      handledInSession.add(responseKey);

      try {
        const lastHandledResponse = await AsyncStorage.getItem(LAST_HANDLED_NOTIFICATION_RESPONSE_KEY)
          .catch(() => null);
        if (lastHandledResponse !== responseKey) {
          handleResponse(response);
          await AsyncStorage.setItem(LAST_HANDLED_NOTIFICATION_RESPONSE_KEY, responseKey)
            .catch(() => undefined);
        }
      } finally {
        await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    };

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      recordRoutine(notification, "received");
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void consumeResponse(response);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) void consumeResponse(response);
    }).catch(() => undefined);
    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [router, token, user?.id]);

  return null;
}
