import { processMediaCleanupJob } from "../mediaCleanup/index.js";
import { db } from "../../storage/db.js";
import { createAuthAccountRouter as createRouter } from "./route.js";
import { AuthAccountService } from "./service.js";
import { SqliteAuthAccountRepository } from "./sqliteRepository.js";
import { EmailVerificationService } from "./emailVerification.js";
import { verificationMailer } from "../../services/verificationMailer.js";

export function createAuthAccountRouter() {
  const repository = new SqliteAuthAccountRepository(db);
  return createRouter(new AuthAccountService(repository, processMediaCleanupJob), new EmailVerificationService(repository, verificationMailer));
}
