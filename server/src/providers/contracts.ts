export type DeploymentProfile = "china" | "global";

export type ProviderCapability = "storage" | "notification" | "auth" | "analytics" | "map" | "payment";

export type ProviderSelection = {
  storage: "local-filesystem" | "supabase-storage";
  notification: "expo-push";
  auth: "aliyun-pnvs" | "password-jwt";
  analytics: "server-events";
  map: "disabled";
  payment: "disabled";
};

export type ProviderProfile = {
  id: DeploymentProfile;
  providers: ProviderSelection;
  processingRegion: string;
  dataResidency: string;
  capabilities: Record<ProviderCapability, boolean>;
};

export type ProviderFailureCode = "unavailable" | "timeout" | "rate_limited" | "rejected" | "invalid_response";

export class ProviderOperationError extends Error {
  readonly providerId: string;
  readonly code: ProviderFailureCode;
  readonly retryable: boolean;

  constructor(
    providerId: string,
    code: ProviderFailureCode,
    message: string,
    retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderOperationError";
    this.providerId = providerId;
    this.code = code;
    this.retryable = retryable;
  }
}

export type ProviderOperationResult<T> = {
  value: T;
  providerId: string;
  degraded: boolean;
};

export interface StorageProvider {
  readonly id: ProviderSelection["storage"];
  putObject(input: { objectPath: string; body: Uint8Array; contentType: string; signal: AbortSignal }): Promise<{ url: string }>;
  deleteObjects(input: { objectPaths: string[]; signal: AbortSignal }): Promise<void>;
}

export interface NotificationProvider {
  readonly id: ProviderSelection["notification"];
  send(input: { recipient: string; title: string; body: string; data: Record<string, unknown>; signal: AbortSignal }): Promise<{ receiptId: string | null }>;
}

export interface AuthProvider {
  readonly id: ProviderSelection["auth"];
  verify(input: { subject: string; proof: string; signal: AbortSignal }): Promise<{ externalSubject: string }>;
}

export interface AnalyticsProvider {
  readonly id: ProviderSelection["analytics"];
  track(input: { event: string; anonymousId: string; properties: Record<string, unknown>; signal: AbortSignal }): Promise<void>;
}

export interface MapProvider {
  readonly id: ProviderSelection["map"];
  geocode(input: { query: string; signal: AbortSignal }): Promise<Array<{ latitude: number; longitude: number }>>;
}

export interface PaymentProvider {
  readonly id: ProviderSelection["payment"];
  createCheckout(input: { orderId: string; amountMinor: number; currency: string; signal: AbortSignal }): Promise<{ redirectUrl: string }>;
}

export type SmsSendResult = {
  success: boolean;
  code: string;
  message: string;
  requestId: string | null;
  bizId: string | null;
  outId: string;
};

export type SmsVerifyResult = {
  success: boolean;
  passed: boolean;
  code: string;
  message: string;
  outId: string;
};

export type SmsServiceConfig = {
  enabled: boolean;
  signName: string;
  templateCode: string;
  packageTotal: number;
  packageBaselineRemaining: number;
  packageBaselineAt: string | null;
  phoneHourlyLimit: number;
  phoneDailyLimit: number;
  ipHourlyLimit: number;
  ipDailyLimit: number;
  globalDailyLimit: number;
};

export interface SmsProvider {
  readonly id?: string;
  send(phone: string, outId: string, config: SmsServiceConfig): Promise<SmsSendResult>;
  verify(phone: string, outId: string, code: string): Promise<SmsVerifyResult>;
}
