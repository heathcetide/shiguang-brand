export type InsightsErrorCode =
  | "INTERVENTION_CONFIRMATION_REQUIRED" | "INTERVENTION_IDEMPOTENCY_CONFLICT" | "INTERVENTION_NOT_FOUND" | "INTERVENTION_NO_LONGER_ACTIONABLE"
  | "HOUSEHOLD_INVENTORY_NOT_FOUND"
  | "INVENTORY_NOT_FOUND"
  | "INVENTORY_VERSION_CONFLICT"
  | "OUTCOME_NOT_FOUND"
  | "OUTCOME_VERSION_CONFLICT"
  | "INVALID_WEEK_START"
  | "HOUSEHOLD_REPORT_NOT_FOUND";

export class InsightsError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: InsightsErrorCode;

  constructor(status: 400 | 404 | 409, message: string, code: InsightsErrorCode) {
    super(message);
    this.name = "InsightsError";
    this.status = status;
    this.code = code;
  }
}
