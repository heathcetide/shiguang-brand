import type { AiContextRows } from "./types.js";

export interface AiContextRepository {
  load(userId: number, date: string): Promise<AiContextRows>;
}
