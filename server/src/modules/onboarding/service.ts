import type { OnboardingUpdate } from "@dietdigidose/contracts";
import { conflict, fingerprint, invalidCompletion, OnboardingError, type OnboardingEvent, type OnboardingRecord } from "./domain.js";
import type { OnboardingRepository } from "./repository.js";

export class OnboardingService {
  private readonly repository: OnboardingRepository;
  constructor(repository: OnboardingRepository) { this.repository = repository; }

  async get(userId: number) {
    const current = await this.repository.load(userId);
    if (current.state.status !== "in_progress" && current.state.status !== "paused") return current.state;
    const completion = await this.repository.findCompletion(userId, current);
    if (!completion) return current.state;
    const now = new Date().toISOString();
    const next: OnboardingRecord = { ...current, state: { ...current.state, version: current.state.version + 1, status: "completed", completion, completedAt: now, updatedAt: now } };
    return await this.repository.save(userId, current.state.version, next, "onboarding_completed")
      ? next.state : (await this.repository.load(userId)).state;
  }

  async update(userId: number, input: OnboardingUpdate) {
    const current = await this.repository.load(userId);
    const requestFingerprint = fingerprint(input);
    if (input.requestKey && input.requestKey === current.lastRequestKey) {
      if (requestFingerprint !== current.lastRequestFingerprint) throw conflict();
      return current.state;
    }
    if (input.version !== current.state.version) throw conflict();
    if (input.status === "not_started" && current.state.status !== "not_started") throw new OnboardingError(422, "ONBOARDING_INVALID_TRANSITION", "已开始的任务可以暂停或切换，不能重置为未开始");
    if (current.state.status === "completed" && (input.selectedTask && input.selectedTask !== current.state.selectedTask || input.status && input.status !== "completed")) {
      throw new OnboardingError(422, "ONBOARDING_ALREADY_COMPLETED", "首次任务已完成，可从首页继续使用其他功能");
    }
    const next: OnboardingRecord = { ...current, state: { ...current.state }, lastRequestKey: input.requestKey ?? null, lastRequestFingerprint: input.requestKey ? requestFingerprint : null };
    const state = next.state;
    const now = new Date().toISOString();
    let event: OnboardingEvent | null = null;
    if (input.selectedTask && (input.selectedTask !== state.selectedTask || state.startedAt === null)) {
      next.baseline = await this.repository.captureBaseline(userId, input.selectedTask);
      state.selectedTask = input.selectedTask;
      state.startedAt = now;
      state.status = "in_progress";
      state.step = "conditions";
      state.dismissed = false;
      event = "onboarding_started";
    }
    if (input.status) state.status = input.status;
    if ((state.status === "in_progress" || state.status === "completed") && !state.selectedTask) throw new OnboardingError(422, "ONBOARDING_TASK_REQUIRED", "请先选择一个任务");
    if (input.step) state.step = input.step;
    if (input.dismissed !== undefined) state.dismissed = input.dismissed;
    if (state.status === "in_progress" && current.state.status === "paused" && !event) event = "onboarding_resumed";
    if (input.completion && state.status !== "completed") throw invalidCompletion();
    if (state.status === "completed" && current.state.status !== "completed") {
      state.completion = await this.repository.findCompletion(userId, next, input.completion);
      if (!state.completion) throw invalidCompletion();
      state.completedAt = now;
      event = "onboarding_completed";
    }
    state.version += 1;
    state.updatedAt = now;
    if (!await this.repository.save(userId, current.state.version, next, event)) {
      const reloaded = await this.repository.load(userId);
      if (input.requestKey === reloaded.lastRequestKey && requestFingerprint === reloaded.lastRequestFingerprint) return reloaded.state;
      throw conflict();
    }
    return state;
  }

  async saveFailed(userId: number, requestKey: string) {
    const current = await this.repository.load(userId);
    if (current.state.selectedTask && current.state.status !== "completed") await this.repository.saveFailed(userId, requestKey);
    return current.state;
  }
}
