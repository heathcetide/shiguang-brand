export interface NotificationPreferences {
  expiring_alert: boolean;
  meal_reminder: boolean;
  water_reminder: boolean;
  breakfast_time: string;
  lunch_time: string;
  dinner_time: string;
  water_start_time: string;
  water_end_time: string;
  water_interval_minutes: number;
  quiet_start_time: string;
  quiet_end_time: string;
  weekdays_enabled: boolean;
  weekends_enabled: boolean;
}

export type NotificationFilter = "all" | "pending" | "system";
export type NotificationAction = "complete" | "snooze_today" | "open" | "plan_recipe";

export interface PushMessage {
  priority?: "normal" | "high";
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface ExpoTicket {
  id?: string;
  status?: string;
  message?: string;
  details?: { error?: string };
}

export interface PushReceiptCandidate {
  ticketId: string;
  userId: number;
  notificationId: number | null;
  token: string;
}

export interface PushReceiptResult extends PushReceiptCandidate {
  receipt: ExpoTicket;
}

export interface CampaignDevice {
  id: number;
  userId: number;
  token: string;
}

export interface CampaignStart {
  campaignId: number;
  recipientCount: number;
  devices: CampaignDevice[];
}

export interface CampaignDelivery {
  deviceId: number;
  userId: number;
  status: "accepted" | "failed";
  errorCode: string | null;
}

export interface PreparedExpiryNotification {
  userId: number;
  notificationId: number;
  inventoryItemId: number;
  title: string;
  body: string;
  tokens: string[];
}

export interface AdminNotificationData {
  interventionMetrics?: Record<string, number>;
  activeDevices: number;
  enabledUsers: number;
  campaigns: Array<Record<string, unknown>>;
  automatic: Array<Record<string, unknown>>;
  eventCounts: Record<string, number>;
}
