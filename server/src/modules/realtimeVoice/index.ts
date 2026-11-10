import { cancelSupervisorRun, startSupervisorRun, waitForSupervisorRunCompletion } from "../../services/agent/runtime.js";
import { transcribeAudio } from "../../services/aiService.js";
import { createRealtimeVoiceRouter } from "./route.js";
import { RealtimeVoiceService } from "./service.js";
import { SqliteRealtimeVoiceRepository } from "./sqliteRepository.js";

export function createRealtimeVoiceModule(database: ConstructorParameters<typeof SqliteRealtimeVoiceRepository>[0]) {
  const service = new RealtimeVoiceService(new SqliteRealtimeVoiceRepository(database), {
    transcribe: transcribeAudio,
    startRun: (userId, input, priority, onReplyDelta) =>
      startSupervisorRun(userId, input as Parameters<typeof startSupervisorRun>[1], priority, onReplyDelta),
    waitForRun: waitForSupervisorRunCompletion,
    cancelRun: cancelSupervisorRun,
  });
  return createRealtimeVoiceRouter(service);
}

export { RealtimeVoiceService } from "./service.js";
export type { RealtimeVoiceRepository } from "./repository.js";
