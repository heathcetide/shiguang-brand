import type { AIUsageWrite } from "./types.js";

export interface AIRuntimeRepository {
  settings(keys: string[]): Promise<Record<string, string>>;
  saveSettings(entries: Array<{ key: string; value: string }>): Promise<void>;
  compareAndSaveSetting(key: string, previous: string | null, value: string | null, expected?: Record<string, string | null>, entries?: Array<{ key: string; value: string }>): Promise<boolean>;
  recordUsage(input: AIUsageWrite): Promise<void>;
}
