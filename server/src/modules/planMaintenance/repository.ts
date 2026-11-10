export type MaintenanceSettings = {
  enabled: boolean;
  timeZone: string | null;
  localTime: string | null;
  nextCheckAt: string | null;
  nextLocalDate: string | null;
  lastCompletedLocalDate: string | null;
  version: number;
};
export interface PlanMaintenanceRepository {
  runs(userId: number): Promise<import("@dietdigidose/contracts").PlanMaintenanceRun[]>;
  settings(userId: number): Promise<MaintenanceSettings | null>;
  saveSettings(userId: number, expectedVersion: number, settings: MaintenanceSettings): Promise<boolean>;
}
