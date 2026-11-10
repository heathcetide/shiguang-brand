import type { OnboardingCompletion, OnboardingTask } from "@dietdigidose/contracts";
import type { Baseline, OnboardingEvent, OnboardingRecord } from "./domain.js";

export interface OnboardingRepository {
  load(userId: number): Promise<OnboardingRecord>;
  captureBaseline(userId: number, task: OnboardingTask): Promise<Baseline>;
  findCompletion(userId: number, current: OnboardingRecord, requested?: OnboardingCompletion): Promise<OnboardingCompletion | null>;
  save(userId: number, expectedVersion: number, next: OnboardingRecord, event: OnboardingEvent | null): Promise<boolean>;
  saveFailed(userId: number, requestKey: string): Promise<void>;
}
