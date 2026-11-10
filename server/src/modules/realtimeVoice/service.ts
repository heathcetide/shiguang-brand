import { randomUUID } from "node:crypto";
import type { RealtimeVoiceRepository } from "./repository.js";
import { RealtimeVoiceError } from "./errors.js";
import type { RealtimeVoiceSession } from "./types.js";

interface SupervisorRun {
  id: string; status: string; reply?: string | null; error?: { message?: string } | null;
}

export interface RealtimeVoiceDependencies {
  transcribe(audioBase64: string, input: { userId: number; mimeType: string; agentName: string; phase: string }): Promise<{ text: string }>;
  startRun(userId: number, input: Record<string, unknown>, priority: number,
    onReplyDelta?: (runId: string, delta: string) => Promise<void> | void): Promise<{ run: SupervisorRun }>;
  waitForRun(runId: string): Promise<SupervisorRun>;
  cancelRun(userId: number, runId: string): Promise<void>;
}

function timestamp(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

function deterministicIntent(text: string) {
  if (/上一步|返回上一步/.test(text)) return { intent: "control", action: "PREV_STEP" };
  if (/暂停.*(?:计时|倒计时)|停一下计时/.test(text)) return { intent: "control", action: "PAUSE_TIMER" };
  if (/开始.*(?:计时|倒计时)|继续(?:倒)?计时/.test(text)) return { intent: "control", action: "START_TIMER" };
  // Only explicit navigation commands advance the recipe, not questions that
  // mention “下一步” or “继续”. Specific timer commands above take priority.
  const command = text.trim().replace(/[，。！!,.\s]+$/u, "");
  if (/^(?:请|请帮我|帮我)?\s*(?:下一步|继续(?:下一步)?)(?:吧)?$/u.test(command))
    return { intent: "control", action: "NEXT_STEP" };
  const add = /(?:增加|加)(\d{1,2})(?:分钟|分)/.exec(text);
  if (add) return { intent: "control", action: "ADD_TIMER", seconds: Number(add[1]) * 60 };
  const writeVerb = /保存|记录|添加|新增|创建|制定|生成|修改|更新|删除|扣减|清空|打卡|完成/;
  const businessObject = /餐单|采购|购物|库存|饮食|健康|体重|饮水|厨具|菜谱|食材|烹饪/;
  if (/删除|扣减库存|记录饮食|打卡|完成烹饪|清空/.test(text) || (writeVerb.test(text) && businessObject.test(text)))
    return { intent: "confirmation_required", action: "PERSISTENT_WRITE" };
  return { intent: "question", action: null };
}

export function publicRealtimeVoiceSession(session: RealtimeVoiceSession) {
  return { id: session.id, recipeId: session.recipeId, status: session.status, platform: session.platform,
    version: session.version, connectedAt: session.connectedAt, expiresAt: session.expiresAt, metrics: {
      firstTranscriptMs: session.firstTranscriptMs, firstResponseMs: session.firstResponseMs,
      interruptions: session.interruptions, reconnects: session.reconnects, fallbacks: session.fallbacks,
    } };
}

export class RealtimeVoiceService {
  private readonly repository: RealtimeVoiceRepository;
  private readonly dependencies: RealtimeVoiceDependencies;
  constructor(repository: RealtimeVoiceRepository, dependencies: RealtimeVoiceDependencies) {
    this.repository = repository; this.dependencies = dependencies;
  }

  async create(userId: number, input: { recipeId: number; platform: string; idempotencyKey: string; currentStep: number;
    recipeSteps: unknown[]; recipeIngredients: string[] }) {
    const result = await this.repository.createSession({ id: randomUUID(), userId, recipeId: input.recipeId, platform: input.platform,
      idempotencyKey: input.idempotencyKey, context: { currentStep: input.currentStep, recipeSteps: input.recipeSteps,
        recipeIngredients: input.recipeIngredients } });
    if (result.status === "recipe_missing") throw new RealtimeVoiceError(404, "RECIPE_NOT_AVAILABLE", "菜谱不存在或不可用于实时语音");
    return { session: publicRealtimeVoiceSession(result.session), repeated: result.status === "repeated" };
  }

  async heartbeat(userId: number, sessionId: string, input: { version: number; muted?: boolean; reconnect?: boolean }) {
    const session = await this.repository.session(sessionId, userId);
    if (!session || session.status === "closed") throw new RealtimeVoiceError(404, "REALTIME_VOICE_SESSION_NOT_FOUND", "实时语音会话不存在");
    if (session.version !== input.version) throw new RealtimeVoiceError(409, "REALTIME_VOICE_VERSION_CONFLICT", "会话状态已更新");
    const status = input.muted === undefined ? session.status : input.muted ? "muted" : "active";
    const updated = await this.repository.heartbeat(sessionId, userId, input.version, status, Boolean(input.reconnect));
    if (!updated) throw new RealtimeVoiceError(409, "REALTIME_VOICE_VERSION_CONFLICT", "会话状态已更新");
    return { session: publicRealtimeVoiceSession(updated) };
  }

  async audio(userId: number, sessionId: string, input: { turnId: string; sequence: number; audioBase64: string; mimeType: string; final: boolean }) {
    const session = await this.repository.session(sessionId, userId);
    if (!session) throw new RealtimeVoiceError(404, "REALTIME_VOICE_SESSION_NOT_FOUND", "实时语音会话不存在");
    this.assertActive(session);
    const prior = await this.repository.transcript(sessionId, input.turnId, input.sequence);
    if (prior) return { turnId: input.turnId, sequence: input.sequence, transcript: prior.transcript,
      final: prior.final, latencyMs: prior.latencyMs, repeated: true };
    const startedAt = Date.now();
    let result: { text: string };
    try { result = await this.dependencies.transcribe(input.audioBase64, { userId, mimeType: input.mimeType,
      agentName: "RealtimeVoiceAgent", phase: input.final ? "final-transcript" : "partial-transcript" }); }
    catch { throw new RealtimeVoiceError(503, "REALTIME_TRANSCRIPTION_UNAVAILABLE", "增量语音识别暂不可用"); }
    const transcript = result.text.trim(); const latencyMs = Date.now() - startedAt;
    const audioBytes = Math.floor(String(input.audioBase64).replace(/^data:[^,]+,/, "").length * 0.75);
    await this.repository.recordTranscript({ sessionId, turnId: input.turnId, userId, sequence: input.sequence, transcript,
      final: input.final, audioBytes, latencyMs, firstTranscriptMs: Math.max(0, Date.now() - timestamp(session.connectedAt)) });
    return { turnId: input.turnId, sequence: input.sequence, transcript, final: input.final, latencyMs, repeated: false };
  }

  async turn(userId: number, sessionId: string, input: { turnId: string; transcript: string; currentStep: number;
    timerSeconds: number; interruptedResponse?: boolean }) {
    const session = await this.repository.session(sessionId, userId);
    if (!session) throw new RealtimeVoiceError(410, "REALTIME_VOICE_SESSION_EXPIRED", "实时语音会话已结束");
    this.assertActive(session);
    const prior = await this.repository.turn(sessionId, userId, input.turnId);
    if (prior) return { turnId: prior.id, intent: prior.intent, action: prior.action, repeated: true };
    const text = String(input.transcript); const parsed = deterministicIntent(text);
    const connectedMs = Math.max(0, Date.now() - timestamp(session.connectedAt));
    await this.repository.recordTurnActivity(sessionId, connectedMs, Boolean(input.interruptedResponse));
    if (input.interruptedResponse) {
      const interrupted = await this.repository.interruptedTurn(sessionId, userId);
      if (interrupted?.agentRunId) try { await this.dependencies.cancelRun(userId, interrupted.agentRunId); } catch { /* terminal */ }
      await this.repository.emitEvent(sessionId, "response.cancelled", { turnId: interrupted?.id || input.turnId,
        interruptedByTurnId: input.turnId, reason: "barge_in" });
    }
    if (parsed.intent !== "question") {
      const action = parsed.intent === "confirmation_required"
        ? { action: parsed.action, requiresConfirmation: true, message: "该操作会修改持久数据，请在屏幕上确认后执行" }
        : { action: parsed.action, seconds: parsed.seconds || 0 };
      await this.repository.recordTurn({ id: input.turnId, sessionId, userId, transcript: text, intent: parsed.intent, action,
        eventType: parsed.intent === "control" ? "control.ready" : "confirmation.required", eventPayload: { turnId: input.turnId, ...action } });
      return { turnId: input.turnId, intent: parsed.intent, action, repeated: false };
    }
    const stream = { text: "", nextIndex: 0, turnReady: false, pending: [] as Array<{ runId: string; delta: string }>,
      writes: Promise.resolve() };
    const appendDelta = async (runId: string, delta: string) => {
      const accepted = await this.repository.appendResponseDelta({ sessionId, userId, turnId: input.turnId, runId,
        index: stream.nextIndex, delta, firstResponseMs: Math.max(0, Date.now() - timestamp(session.connectedAt)) });
      if (accepted) { stream.text += delta; stream.nextIndex += 1; }
    };
    const onReplyDelta = (runId: string, delta: string) => {
      if (!stream.turnReady) { stream.pending.push({ runId, delta }); return Promise.resolve(); }
      stream.writes = stream.writes.then(() => appendDelta(runId, delta));
      return stream.writes;
    };
    const response = await this.dependencies.startRun(userId, { modality: "cooking", source: "realtime_cooking_voice", sessionId,
      idempotencyKey: `realtime-voice:${sessionId}:${input.turnId}`,
      prompt: `${text}\n当前菜品：${String(session.context.recipeTitle || "当前菜品")}；当前步骤序号：${input.currentStep}；计时：${input.timerSeconds} 秒。回答限 80 字。`,
      metadata: { realtimeVoiceSessionId: sessionId, turnId: input.turnId, currentStep: input.currentStep } }, 0, onReplyDelta);
    await this.repository.recordTurn({ id: input.turnId, sessionId, userId, transcript: text, intent: "question", action: {},
      agentRunId: response.run.id, eventType: "response.started", eventPayload: { turnId: input.turnId, runId: response.run.id } });
    for (const pending of stream.pending.splice(0)) stream.writes = stream.writes.then(() => appendDelta(pending.runId, pending.delta));
    stream.turnReady = true;
    void this.completeRun(userId, sessionId, input.turnId, response.run.id, stream);
    return { turnId: input.turnId, intent: "question", run: response.run, repeated: false };
  }

  async sessionEvents(userId: number, sessionId: string, after: number) {
    const session = await this.repository.session(sessionId, userId);
    if (!session) throw new RealtimeVoiceError(404, "REALTIME_VOICE_SESSION_NOT_FOUND", "实时语音会话不存在");
    return { session: publicRealtimeVoiceSession(session), events: await this.repository.events(sessionId, after) };
  }

  async close(userId: number, sessionId: string) {
    const session = await this.repository.session(sessionId, userId);
    if (!session) throw new RealtimeVoiceError(404, "REALTIME_VOICE_SESSION_NOT_FOUND", "实时语音会话不存在");
    if (session.status !== "closed") for (const runId of await this.repository.pendingRuns(sessionId, userId)) {
      try { await this.dependencies.cancelRun(userId, runId); } catch { /* terminal */ }
    }
    const closed = session.status === "closed" ? session : await this.repository.close(sessionId, userId);
    return { session: publicRealtimeVoiceSession(closed ?? session) };
  }

  private assertActive(session: RealtimeVoiceSession) {
    if (!["active", "muted"].includes(session.status) || timestamp(session.expiresAt) <= Date.now())
      throw new RealtimeVoiceError(410, "REALTIME_VOICE_SESSION_EXPIRED", "实时语音会话已结束");
  }
  private async completeRun(userId: number, sessionId: string, turnId: string, runId: string,
    stream: { text: string; nextIndex: number; writes: Promise<void> }) {
    try {
      const run = await this.dependencies.waitForRun(runId);
      await stream.writes;
      const active = await this.repository.session(sessionId, userId);
      if (!active || active.status === "closed" || run.status === "cancelled" || run.status === "expired") return;
      const text = run.reply || run.error?.message || "暂时无法回答，请使用屏幕操作继续烹饪";
      if (stream.text && text.startsWith(stream.text) && text.length > stream.text.length) {
        const delta = text.slice(stream.text.length);
        const accepted = await this.repository.appendResponseDelta({ sessionId, userId, turnId, runId,
          index: stream.nextIndex, delta, firstResponseMs: Math.max(0, Date.now() - timestamp(active.connectedAt)) });
        if (accepted) { stream.text += delta; stream.nextIndex += 1; }
      }
      await this.repository.completeResponse({ sessionId, turnId, text, status: run.status,
        firstResponseMs: Math.max(0, Date.now() - timestamp(active.connectedAt)) });
    } catch { await this.repository.emitEvent(sessionId, "response.failed", { turnId }); }
  }
}
