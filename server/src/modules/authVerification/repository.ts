import type {
  PhoneBindingUser, PhoneBindingInput, PhoneBindingResult,
  PhoneReplacementInput, PhoneReplacementResult,
  ChallengeCreate,
  DeliveryReport,
  EventFilters,
  EventPage,
  RegistrationResult,
  UsageCounter,
  VerificationChallenge,
  VerificationEventInput,
  VerificationSubject,
  ReauthUser,
  ReauthGrantInput,
} from "./types.js";

export interface AuthVerificationRepository {
  phoneBindingUser(userId: number): Promise<PhoneBindingUser | null>;
  bindPhone(input: PhoneBindingInput): Promise<PhoneBindingResult>;
  replacePhone(input: PhoneReplacementInput): Promise<PhoneReplacementResult>;
  settings(keys: string[]): Promise<Record<string, string>>;
  saveSettings(entries: Array<{ key: string; value: string }>): Promise<void>;
  findOrCreateSubject(input: Omit<VerificationSubject, "id" | "user_id"> & { provider: string }): Promise<VerificationSubject>;
  recordEvent(provider: string, input: VerificationEventInput): Promise<void>;
  incrementUsage(usageDate: string, provider: string, counter: UsageCounter, amount: number): Promise<void>;
  countSubjectSends(subjectId: number, since: string): Promise<number>;
  countIpSends(ip: string, since: string): Promise<number>;
  globalDailySends(usageDate: string, provider: string): Promise<number>;
  createChallenge(input: ChallengeCreate): Promise<void>;
  failChallenge(challengeId: string): Promise<void>;
  acceptChallenge(challengeId: string, subjectId: number, bizId: string | null, requestId: string | null): Promise<void>;
  challenge(challengeId: string): Promise<VerificationChallenge | null>;
  expireChallenge(challengeId: string): Promise<void>;
  beginVerification(challengeId: string): Promise<boolean>;
  restoreVerification(challengeId: string): Promise<void>;
  rejectVerification(challengeId: string): Promise<void>;
  userByPhone(phone: string): Promise<{ id: number; is_disabled: number | boolean } | null>;
  completeLogin(input: { userId: number; subjectId: number; challengeId: string; at: string; sourceIp: string }): Promise<void>;
  markRegistrationRequired(input: { challengeId: string; at: string; tokenHash: string; expiresAt: string }): Promise<void>;
  registrationChallenge(tokenHash: string): Promise<VerificationChallenge | null>;
  register(input: { tokenHash: string; phone: string; username: string; passwordHash: string | null; at: string }): Promise<RegistrationResult>;
  reauthUser(userId: number): Promise<ReauthUser | null>;
  issueReauthGrant(input: ReauthGrantInput): Promise<boolean>;
  userResponse(userId: number): Promise<Record<string, unknown> | null>;
  recentSendEvent(): Promise<Record<string, unknown> | null>;
  usageOverview(provider: string, firstUsageDate: string): Promise<{ totals: Record<string, number>; daily: Array<Record<string, unknown>> }>;
  usedSince(provider: string, baselineAt: string | null): Promise<number>;
  attacks(since: string): Promise<Array<Record<string, unknown>>>;
  events(filters: EventFilters, page: number, pageSize: number): Promise<EventPage>;
  eventSubject(eventId: number): Promise<Record<string, unknown> | null>;
  updateTestChallenge(challengeId: string, status: string, bizId: string | null, requestId: string | null): Promise<void>;
  recordDeliveryReport(provider: string, report: DeliveryReport): Promise<boolean>;
}
