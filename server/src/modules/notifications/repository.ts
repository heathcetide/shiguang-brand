import type {
  AdminNotificationData,
  CampaignDelivery,
  CampaignStart,
  ExpoTicket,
  NotificationAction,
  NotificationFilter,
  NotificationPreferences,
  PreparedExpiryNotification,
  PushMessage,
  PushReceiptCandidate,
  PushReceiptResult,
} from "./types.js";

export interface NotificationsRepository {
  feedbackIntervention(userId: number,id: string,input: import("@dietdigidose/contracts").InterventionFeedback,now: number): Promise<import("../interventions/feedback.js").InterventionFeedbackDecision>;
  activeInterventionSnooze(userId: number,now: number): Promise<number | null>;
  interventionCard(userId: number,id: string): Promise<Record<string,unknown> | null>;
  interventionScanCursor(): Promise<number>;
  advanceInterventionScan(expected: number,next: number,owner: string): Promise<boolean>;
  interventionScanUsers(afterId: number,limit: number): Promise<number[]>;
  interventionQueue(userId: number): Promise<Record<string,unknown>[]>;
  pendingInterventionUsers(now: number,limit: number): Promise<number[]>;
  claimIntervention(userId: number,now: number,owner: string,featureEnabled: boolean): Promise<import("../interventions/delivery.js").InterventionDeliveryClaim | null>;
  finishIntervention(id: string,owner: string,now: number,result: import("../interventions/delivery.js").InterventionDeliveryResult): Promise<boolean>;
  reserveIntervention(input: import("../interventions/reservation.js").InterventionReservation): Promise<Record<string,unknown>>;
  interventionPreferences(userId: number): Promise<Record<string,unknown> | null>;
  saveInterventionPreferences(userId: number,input: import("@dietdigidose/contracts").InterventionPreferencesUpdate): Promise<Record<string,unknown> | null>;
  preferences(userId: number): Promise<NotificationPreferences | null>;
  savePreferences(userId: number, preferences: NotificationPreferences): Promise<void>;
  saveDevice(userId: number, token: string, platform: string): Promise<void>;
  ensureRoutineNotification(input: {
    userId: number; kind: "meal" | "water"; key: string; dateKey: string; title: string; body: string;
  }): Promise<void>;
  unreadCount(userId: number): Promise<number>;
  history(userId: number, filter: NotificationFilter, cursor: number | null, limit: number): Promise<Array<Record<string, unknown>>>;
  readAll(userId: number): Promise<number>;
  read(userId: number, notificationId: number): Promise<boolean>;
  action(userId: number, notificationId: number, action: NotificationAction, metadata?: unknown): Promise<boolean>;
  localEvent(input: { userId: number; kind: string; title: string; body: string; event: string; sourceId?: string }): Promise<number>;
  adminData(since: string): Promise<AdminNotificationData>;
  beginCampaign(adminUserId: number, title: string, body: string): Promise<CampaignStart>;
  finishCampaign(campaignId: number, deliveries: CampaignDelivery[], success: number, failure: number): Promise<void>;
  failCampaign(campaignId: number, failureCount: number): Promise<void>;
  recordPushTickets(entries: Array<{ message: PushMessage; ticket: ExpoTicket }>): Promise<void>;
  pendingReceipts(before: string, limit: number): Promise<PushReceiptCandidate[]>;
  applyReceipts(receipts: PushReceiptResult[]): Promise<void>;
  prepareExpiring(today: string, deadline: string): Promise<PreparedExpiryNotification[]>;
  markExpiringDeliveries(today: string, statuses: Array<{ userId: number; status: "accepted" | "failed" | "inbox_only" }>): Promise<void>;
}
