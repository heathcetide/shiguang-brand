import type Database from "better-sqlite3";
import type { PoolClient } from "pg";
import { AuthAccountError } from "./errors.js";

export type AccountMutationProof = { tokenHash: string } | { passwordHash: string } | { emailTokenHash: string };
export type AccountMutationPurpose = "password_update" | "account_delete";
function invalidProof(): never { throw new AuthAccountError(403, "身份验证已失效，请重新验证", "REAUTH_REQUIRED"); }

export function consumeAccountProofSqlite(database: Database.Database, userId: number, purpose: AccountMutationPurpose, proof: AccountMutationProof) {
  if ("emailTokenHash" in proof) {
    if (purpose !== "password_update") invalidProof();
    const result = database.prepare(`UPDATE email_auth_challenges SET status='consumed'
      WHERE recovery_hash=? AND user_id=? AND purpose='email_recovery' AND status='verified'
      AND julianday(recovery_expires_at)>julianday('now')
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.email=email_auth_challenges.email
        AND u.email_verified_at IS NOT NULL AND u.session_version=email_auth_challenges.session_version AND COALESCE(u.is_disabled,0)=0)`)
      .run(proof.emailTokenHash,userId);
    if (result.changes !== 1) invalidProof();
    return;
  }
  if ("passwordHash" in proof) {
    if (!database.prepare("SELECT 1 FROM users WHERE id=? AND password_hash=?").get(userId, proof.passwordHash)) invalidProof();
    return;
  }
  const result = database.prepare(`UPDATE account_reauth_grants SET consumed_at=CURRENT_TIMESTAMP
    WHERE token_hash=? AND user_id=? AND purpose=? AND consumed_at IS NULL AND datetime(expires_at)>datetime('now')
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.phone=account_reauth_grants.phone
      AND u.phone_verified_at IS NOT NULL AND u.session_version=account_reauth_grants.session_version AND COALESCE(u.is_disabled,0)=0)`)
    .run(proof.tokenHash, userId, purpose);
  if (result.changes !== 1) invalidProof();
}

export async function consumeAccountProofPostgres(client: PoolClient, userId: number, purpose: AccountMutationPurpose, proof: AccountMutationProof) {
  await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  if ("emailTokenHash" in proof) {
    if (purpose !== "password_update") invalidProof();
    const result = await client.query(`UPDATE email_auth_challenges c SET status='consumed'
      WHERE recovery_hash=$1 AND user_id=$2 AND purpose='email_recovery' AND status='verified'
      AND recovery_expires_at>CURRENT_TIMESTAMP
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=c.user_id AND u.email=c.email AND u.email_verified_at IS NOT NULL
        AND u.session_version=c.session_version AND NOT COALESCE(u.is_disabled,FALSE))`,[proof.emailTokenHash,userId]);
    if (result.rowCount !== 1) invalidProof();
    return;
  }
  if ("passwordHash" in proof) {
    if (!(await client.query("SELECT 1 FROM users WHERE id=$1 AND password_hash=$2", [userId, proof.passwordHash])).rowCount) invalidProof();
    return;
  }
  const result = await client.query(`UPDATE account_reauth_grants g SET consumed_at=CURRENT_TIMESTAMP
    WHERE token_hash=$1 AND user_id=$2 AND purpose=$3 AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=g.user_id AND u.phone=g.phone AND u.phone_verified_at IS NOT NULL
      AND u.session_version=g.session_version AND NOT COALESCE(u.is_disabled,FALSE))`, [proof.tokenHash,userId,purpose]);
  if (result.rowCount !== 1) invalidProof();
}
