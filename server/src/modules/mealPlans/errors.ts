export class MealPlansError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;

  constructor(status: 400 | 404 | 409, message: string, code: string) {
    super(message);
    this.name = "MealPlansError";
    this.status = status;
    this.code = code;
  }
}
