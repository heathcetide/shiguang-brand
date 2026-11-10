import type { PlanMaintenanceSettingsInput } from "@dietdigidose/contracts";
import { MealPlansError } from "../mealPlans/errors.js";
import type { MaintenanceSettings, PlanMaintenanceRepository } from "./repository.js";
import { nextDailyCheck } from "./schedule.js";

export class PlanMaintenanceService {
  private readonly repository: PlanMaintenanceRepository;
  private readonly now: () => Date;
  constructor(repository: PlanMaintenanceRepository, now = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async runs(userId: number) { return { items: await this.repository.runs(userId) }; }

  async settings(userId: number): Promise<MaintenanceSettings> {
    return await this.repository.settings(userId) ?? { enabled: false, timeZone: null, localTime: null,
      nextCheckAt: null, nextLocalDate: null, lastCompletedLocalDate: null, version: 0 };
  }

  async updateSettings(userId: number, input: PlanMaintenanceSettingsInput) {
    const current = await this.settings(userId);
    const conflict = () => new MealPlansError(409, "检查设置已更新，请刷新后重试", "VERSION_CONFLICT");
    if (current.version !== input.version) throw conflict();
    const next = input.enabled ? nextDailyCheck(this.now(), input, current.lastCompletedLocalDate) : null;
    const settings: MaintenanceSettings = { ...current, enabled: input.enabled,
      timeZone: input.enabled ? input.timeZone : current.timeZone,
      localTime: input.enabled ? input.localTime : current.localTime,
      nextCheckAt: next?.scheduledAt ?? null, nextLocalDate: next?.localDate ?? null, version: current.version + 1 };
    if (!await this.repository.saveSettings(userId, current.version, settings)) throw conflict();
    return settings;
  }
}
