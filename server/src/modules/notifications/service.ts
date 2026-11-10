import { interventionCard } from "../interventions/card.js";
import { scanInterventions } from "../interventions/scan.js";
import type { RecommendationsService } from "../recommendations/service.js";
import type { WorkerTaskContext } from "../worker/types.js";
import type { InterventionDeliveryResult } from "../interventions/delivery.js";
import { formatInterventionPreferences } from "../interventions/preferences.js";
import type { InterventionPreferencesUpdate } from "@dietdigidose/contracts";
import { currentDateKey, dateKeyAfterDays } from "../../utils/date.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";
import type { NotificationsRepository } from "./repository.js";
import type { ExpoTicket, NotificationAction, NotificationFilter, NotificationPreferences, PushMessage } from "./types.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  expiring_alert: true, meal_reminder: true, water_reminder: true,
  breakfast_time: "08:00", lunch_time: "12:00", dinner_time: "18:00",
  water_start_time: "10:00", water_end_time: "18:00", water_interval_minutes: 120,
  quiet_start_time: "22:00", quiet_end_time: "07:00", weekdays_enabled: true, weekends_enabled: true,
};

function isExpoPushToken(value: string) {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(value);
}

export function createNotificationsService(repository: NotificationsRepository,recommendations?: Pick<RecommendationsService,"interventionSnapshot">) {
  const timeZone = process.env.APP_TIME_ZONE?.trim() || "Asia/Shanghai";

  async function sendPush(messages: PushMessage[], control?: { signal: AbortSignal; assertActive: () => Promise<void> }) {
    if (!messages.length) return [];
    const tickets: ExpoTicket[] = [];
    for (let start = 0; start < messages.length; start += 100) {
      await control?.assertActive();
      control?.signal.throwIfAborted();
      const batch = messages.slice(start, start + 100);
      const response = await fetchWithTimeout(EXPO_PUSH_URL, {
        ...(control ? { signal: control.signal } : {}),
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch.map((message) => ({ ...message, sound: "default", priority: message.priority ?? "high",
          ...(message.data.type === "expiring_inventory" ? { categoryId: "inventory-expiring" } : {}) }))),
      });
      if (!response.ok) throw new Error(`Expo Push returned ${response.status}`);
      const result = await response.json() as { data?: ExpoTicket[] };
      const batchTickets = result.data ?? [];
      await repository.recordPushTickets(batchTickets.flatMap((ticket, index) => batch[index] ? [{ message: batch[index]!, ticket }] : []));
      tickets.push(...batchTickets);
    }
    return tickets;
  }

  async function materializeRoutineInbox(userId: number) {
    const preferences = await repository.preferences(userId);
    if (!preferences) return;
    const now = new Date();
    const currentTime = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(now);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
    const isWeekend = weekday === "Sat" || weekday === "Sun";
    if ((isWeekend && !preferences.weekends_enabled) || (!isWeekend && !preferences.weekdays_enabled)) return;
    const dateKey = currentDateKey(now);
    const toMinutes = (value: string | number) => {
      const [hour = 0, minute = 0] = String(value).split(":").map(Number);
      return hour * 60 + minute;
    };
    const currentMinutes = toMinutes(currentTime);
    const quietStart = toMinutes(preferences.quiet_start_time);
    const quietEnd = toMinutes(preferences.quiet_end_time);
    const isQuiet = (minute: number) => quietStart !== quietEnd
      && (quietStart < quietEnd ? minute >= quietStart && minute < quietEnd : minute >= quietStart || minute < quietEnd);
    const ensure = (kind: "meal" | "water", key: string, title: string, body: string) =>
      repository.ensureRoutineNotification({ userId, kind, key, dateKey, title, body });
    if (preferences.meal_reminder) {
      const meals = [
        ["breakfast", preferences.breakfast_time, "早餐打卡提醒", "记下早餐，让今天的营养规划有个好开始。"],
        ["lunch", preferences.lunch_time, "午餐打卡提醒", "记下这一餐，继续完善今天的营养记录。"],
        ["dinner", preferences.dinner_time, "晚餐打卡提醒", "晚餐后花一分钟记录，让今日营养更完整。"],
      ] as const;
      for (const [key, time, title, body] of meals) {
        const minute = toMinutes(time);
        if (minute <= currentMinutes && !isQuiet(minute)) await ensure("meal", key, title, body);
      }
    }
    if (preferences.water_reminder) {
      const start = toMinutes(preferences.water_start_time);
      const end = toMinutes(preferences.water_end_time);
      const interval = preferences.water_interval_minutes || 120;
      let latestDue: number | null = null;
      for (let minute = start; minute <= end; minute += interval) if (minute <= currentMinutes && !isQuiet(minute)) latestDue = minute;
      if (latestDue !== null) await ensure("water", "daily", "今日饮水提醒", "今天的饮水计划正在进行，记得及时补充水分。");
    }
  }

  return {
    feedbackIntervention: (userId: number,id: string,input: import("@dietdigidose/contracts").InterventionFeedback) => repository.feedbackIntervention(userId,id,input,Date.now()),
    async interventionCard(userId: number,id: string) { const row = await repository.interventionCard(userId,id);return row ? interventionCard(row) : null; },
    scanInterventions: (context: WorkerTaskContext) => recommendations ? scanInterventions(repository,recommendations,context) : Promise.resolve({ scanned: 0,candidates: 0,failed: 0 }),
    async sendInterventions(context: WorkerTaskContext,limit = 100) {
      const result = { processed: 0,accepted: 0,failed: 0,uncertain: 0 };
      await context.assertActive();
      const users = await repository.pendingInterventionUsers(Date.now(),limit);
      for (const userId of users) {
        await context.assertActive();
        context.signal.throwIfAborted();
        const started = Date.now();
        const claim = await repository.claimIntervention(userId,started,context.leaseOwnerId,process.env.PROACTIVE_INTERVENTIONS_ENABLED === "1");
        if (!claim) continue;
        // One total deadline across all device batches stays below the delivery lease.
        const signal = AbortSignal.any([context.signal,AbortSignal.timeout(60_000)]);
        let outcome: InterventionDeliveryResult = "uncertain";
        try {
          const tokens = [...new Set(claim.tokens.filter(isExpoPushToken))];
          if (!tokens.length) outcome = "failed";
          else {
            const tickets = await sendPush(tokens.map(to => ({ to,title: claim.title,body: claim.body,priority: claim.priority,
              data: { type: "proactive_intervention",interventionId: claim.id,notificationId: claim.notificationId } })),{
              signal,assertActive: async () => {
                await context.assertActive();
                if (Date.now()-started>=60_000 || process.env.PROACTIVE_INTERVENTIONS_ENABLED !== "1") throw new Error("Intervention delivery stopped");
              },
            });
            if (tickets.length===tokens.length && tickets.every(ticket => ticket?.status === "ok" && typeof ticket.id === "string" && ticket.id.length>0)) outcome = "accepted";
            else if (tickets.length===tokens.length && tickets.every(ticket => ticket?.status === "error")) outcome = "failed";
          }
        } catch {
          // A transport/recording failure may follow Expo acceptance. Never blindly retry.
          outcome = "uncertain";
        }
        const finished = await repository.finishIntervention(claim.id,claim.owner,Date.now(),outcome);
        result.processed += 1;
        result[finished ? outcome : "uncertain"] += 1;
        await context.assertActive();
        context.signal.throwIfAborted();
      }
      return result;
    },
    async interventionPreferences(userId: number) { return formatInterventionPreferences(await repository.interventionPreferences(userId)); },
    async saveInterventionPreferences(userId: number,input: InterventionPreferencesUpdate) {
      const row = await repository.saveInterventionPreferences(userId,input);
      return row ? formatInterventionPreferences(row) : null;
    },
    async preferences(userId: number) { return (await repository.preferences(userId)) ?? DEFAULT_NOTIFICATION_PREFERENCES; },
    async savePreferences(userId: number, preferences: NotificationPreferences) { await repository.savePreferences(userId, preferences); return preferences; },
    async saveDevice(userId: number, token: string, platform: string) { await repository.saveDevice(userId, token, platform); },
    async unreadCount(userId: number) { await materializeRoutineInbox(userId); return repository.unreadCount(userId); },
    async history(userId: number, filter: NotificationFilter, cursor: number | null, limit: number) {
      await materializeRoutineInbox(userId);
      const rows = await repository.history(userId, filter, cursor, limit + 1);
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit);
      return { items, nextCursor: hasMore ? Number(items[items.length - 1]?.id) : null, hasMore };
    },
    readAll: (userId: number) => repository.readAll(userId),
    read: (userId: number, notificationId: number) => repository.read(userId, notificationId),
    action: (userId: number, notificationId: number, action: NotificationAction, metadata?: unknown) =>
      repository.action(userId, notificationId, action, metadata),
    localEvent: (input: { userId: number; kind: string; title: string; body: string; event: string; sourceId?: string }) => repository.localEvent(input),
    async adminData() {
      const data = await repository.adminData(new Date(Date.now() - 30 * 86_400_000).toISOString());
      const counts = data.eventCounts;
      return { ...data, interventionsEnabled: process.env.PROACTIVE_INTERVENTIONS_ENABLED === "1", eventCounts: undefined, metrics: {
        created: counts.created ?? 0, pushSubmitted: counts.push_submitted ?? 0, pushDelivered: counts.push_delivered ?? 0,
        opened: (counts.opened ?? 0) + (counts.action_open ?? 0),
        actionClicks: Object.entries(counts).filter(([key]) => key.startsWith("action_") && key !== "action_open")
          .reduce((sum, [, count]) => sum + count, 0),
        pushFailures: (counts.push_submit_failed ?? 0) + (counts.push_delivery_failed ?? 0),
      } };
    },
    async sendCampaign(adminUserId: number, title: string, body: string) {
      const started = await repository.beginCampaign(adminUserId, title, body);
      try {
        const tickets = await sendPush(started.devices.map((device) => ({
          to: device.token, title, body, data: { type: "admin_campaign", campaignId: started.campaignId },
        })));
        const statuses = new Map<number, "accepted" | "failed">();
        const deliveries = started.devices.map((device, index) => {
          const ticket = tickets[index];
          const status: "accepted" | "failed" = ticket?.status === "ok" ? "accepted" : "failed";
          if (status === "accepted" || !statuses.has(device.userId)) statuses.set(device.userId, status);
          return { deviceId: device.id, userId: device.userId, status, errorCode: ticket?.details?.error ?? null };
        });
        const success = [...statuses.values()].filter((status) => status === "accepted").length;
        const failure = [...statuses.values()].filter((status) => status === "failed").length;
        await repository.finishCampaign(started.campaignId, deliveries, success, failure);
        return { id: started.campaignId, recipients: started.recipientCount, success, failure };
      } catch (error) {
        await repository.failCampaign(started.campaignId, started.devices.length);
        throw error;
      }
    },
    sendExpoPush: sendPush,
    async checkExpoPushReceipts() {
      const pending = await repository.pendingReceipts(new Date(Date.now() - 5 * 60_000).toISOString(), 300);
      if (!pending.length) return { checked: 0 };
      const response = await fetchWithTimeout(EXPO_RECEIPTS_URL, { method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ids: pending.map((item) => item.ticketId) }) });
      if (!response.ok) throw new Error(`Expo receipts returned ${response.status}`);
      const result = await response.json() as { data?: Record<string, ExpoTicket> };
      await repository.applyReceipts(pending.flatMap((item) => result.data?.[item.ticketId]
        ? [{ ...item, receipt: result.data[item.ticketId]! }] : []));
      return { checked: pending.length };
    },
    async sendExpiringInventoryNotifications() {
      const today = currentDateKey();
      const prepared = await repository.prepareExpiring(today, dateKeyAfterDays(3));
      const messages: PushMessage[] = [];
      const owners: number[] = [];
      for (const item of prepared) for (const token of item.tokens) if (isExpoPushToken(token)) {
        messages.push({ to: token, title: item.title, body: item.body,
          data: { type: "expiring_inventory", notificationId: item.notificationId, inventoryItemId: item.inventoryItemId } });
        owners.push(item.userId);
      }
      const tickets = await sendPush(messages);
      const statuses = new Map<number, "accepted" | "failed">();
      tickets.forEach((ticket, index) => {
        const userId = owners[index];
        if (!userId) return;
        if (ticket.status === "ok") statuses.set(userId, "accepted");
        else if (!statuses.has(userId)) statuses.set(userId, "failed");
      });
      await repository.markExpiringDeliveries(today, prepared.map((item) => ({ userId: item.userId, status: statuses.get(item.userId) ?? "inbox_only" })));
      return { recipients: prepared.length, messages: messages.length,
        failedRecipients: [...statuses.values()].filter((status) => status === "failed").length };
    },
  };
}

export type NotificationsService = ReturnType<typeof createNotificationsService>;
