export class AdminFoodAssetsError extends Error {
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message); this.status = status; this.details = details;
  }
}
