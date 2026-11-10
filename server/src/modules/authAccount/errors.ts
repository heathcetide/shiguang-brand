export class AuthAccountError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly recordLoginFailure: boolean;

  constructor(status: number, message: string, code?: string, recordLoginFailure = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.recordLoginFailure = recordLoginFailure;
  }
}
