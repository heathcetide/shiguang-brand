export type StoredAccessUser = {
  sessionVersion: unknown;
  isDisabled: unknown;
  role: unknown;
  mustChangePassword: unknown;
};

export type AccessUser = {
  sessionVersion: number;
  isDisabled: boolean;
  role: string;
  mustChangePassword: boolean;
};

export type SessionTokenClaims = {
  userId: number;
  sessionVersion: number;
};
