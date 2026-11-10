import type { AuthVerificationRepository } from "./repository.js";
import { AuthVerificationService } from "./service.js";

export function createAuthVerificationService(repository: AuthVerificationRepository) {
  return new AuthVerificationService(repository);
}
export { AuthVerificationService } from "./service.js";
export type { AuthVerificationRepository } from "./repository.js";
export type { VerificationChallenge, VerificationEventInput, VerificationSubject } from "./types.js";
