type StoredIdentity = { id: number; username: string; hasPassword?: boolean; phone_verified_at?: string | null };

/** Durable identity/account-state allowlist. Full auth/profile responses stay in memory. */
export function storedAuthIdentity(value: unknown): StoredIdentity {
  if (!value || typeof value !== "object") throw new Error("Invalid saved account");
  const user = value as Record<string, unknown>;
  if (typeof user.id !== "number" || !Number.isInteger(user.id) || user.id <= 0
    || typeof user.username !== "string") throw new Error("Invalid saved account");
  const identity: StoredIdentity = { id: user.id, username: user.username };
  // These non-secret account-state fields keep SMS-only recovery/deletion usable offline.
  if (typeof user.hasPassword === "boolean") identity.hasPassword = user.hasPassword;
  if (typeof user.phone_verified_at === "string" || user.phone_verified_at === null) identity.phone_verified_at = user.phone_verified_at;
  return identity;
}

export function restoredAuthIdentity(value: unknown) {
  return { ...storedAuthIdentity(value), avatar_url: null, bio: null };
}
