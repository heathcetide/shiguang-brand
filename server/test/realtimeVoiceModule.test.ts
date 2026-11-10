import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { AIMessageChunk } from "@langchain/core/messages";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import { RealtimeVoiceError } from "../src/modules/realtimeVoice/errors.js";
import type { RealtimeVoiceRepository } from "../src/modules/realtimeVoice/repository.js";
import { RealtimeVoiceService } from "../src/modules/realtimeVoice/service.js";
import { SqliteRealtimeVoiceRepository } from "../src/modules/realtimeVoice/sqliteRepository.js";
import type { RealtimeVoiceEvent, RealtimeVoiceSession, RealtimeVoiceTurn, TranscriptChunk } from "../src/modules/realtimeVoice/types.js";
import { StructuredReplyDecoder, StructuredReplyStreamHandler } from "../src/services/agent/replyStream.js";

function activeSession(overrides: Partial<RealtimeVoiceSession> = {}): RealtimeVoiceSession {
  return { id: "session-1", userId: 42, recipeId: 7, status: "active", platform: "ios", context: { recipeTitle: "番茄炒蛋" },
    version: 1, connectedAt: new Date(Date.now() - 100).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    firstTranscriptMs: null, firstResponseMs: null, interruptions: 0, reconnects: 0, fallbacks: 0, ...overrides };
}

function fakeRepository(overrides: Partial<RealtimeVoiceRepository> = {}) {
  const state = { session: activeSession(), chunks: new Map<string, TranscriptChunk>(), turns: new Map<string, RealtimeVoiceTurn>(),
    events: [] as RealtimeVoiceEvent[], completed: [] as Array<{ text: string; status: string }>, cancelled: [] as string[] };
  const repository: RealtimeVoiceRepository = {
    createSession: async () => ({ status: "created", session: state.session }),
    session: async (_sessionId, userId) => userId === state.session.userId ? state.session : null,
    heartbeat: async (_sessionId, _userId, version, status, reconnect) => {
      if (version !== state.session.version) return null;
      state.session = { ...state.session, status, version: version + 1, reconnects: state.session.reconnects + Number(reconnect) };
      return state.session;
    },
    transcript: async (_sessionId, turnId, sequence) => state.chunks.get(`${turnId}:${sequence}`) ?? null,
    recordTranscript: async (input) => { state.chunks.set(`${input.turnId}:${input.sequence}`,
      { transcript: input.transcript, final: input.final, latencyMs: input.latencyMs }); },
    turn: async (_sessionId, _userId, turnId) => state.turns.get(turnId) ?? null,
    recordTurnActivity: async () => {},
    interruptedTurn: async () => ({ id: "old-turn", agentRunId: "old-run" }),
    recordTurn: async (input) => { state.turns.set(input.id, { id: input.id, intent: input.intent, action: input.action,
      agentRunId: input.agentRunId ?? null }); },
    emitEvent: async (_sessionId, type, payload) => { const sequence = state.events.length + 1;
      state.events.push({ sequence, type, payload, createdAt: new Date().toISOString() }); return sequence; },
    appendResponseDelta: async (input) => { const sequence = state.events.length + 1;
      state.events.push({ sequence, type: "response.text.delta", payload: { turnId: input.turnId, index: input.index,
        delta: input.delta, upstream: true }, createdAt: new Date().toISOString() }); return true; },
    events: async (_sessionId, after) => state.events.filter((event) => event.sequence > after),
    completeResponse: async (input) => { state.completed.push({ text: input.text, status: input.status }); },
    pendingRuns: async () => ["pending-run"],
    close: async () => { state.session = { ...state.session, status: "closed", version: state.session.version + 1 }; return state.session; },
    ...overrides,
  };
  return { repository, state };
}

function service(repository: RealtimeVoiceRepository, overrides: Partial<ConstructorParameters<typeof RealtimeVoiceService>[1]> = {}) {
  return new RealtimeVoiceService(repository, {
    transcribe: async () => ({ text: "  切好的番茄  " }),
    startRun: async () => ({ run: { id: "run-1", status: "queued" } }),
    waitForRun: async () => ({ id: "run-1", status: "completed", reply: "保持中火翻炒。" }),
    cancelRun: async () => {},
    ...overrides,
  });
}

describe("realtime voice module", () => {
  test("keeps optimistic heartbeats and ownership database-neutral", async () => {
    const { repository, state } = fakeRepository(); const subject = service(repository);
    assert.equal((await subject.heartbeat(42, state.session.id, { version: 1, muted: true, reconnect: true })).session.status, "muted");
    await assert.rejects(() => subject.heartbeat(42, state.session.id, { version: 1 }),
      (error: unknown) => error instanceof RealtimeVoiceError && error.code === "REALTIME_VOICE_VERSION_CONFLICT");
    await assert.rejects(() => subject.sessionEvents(99, state.session.id, 0),
      (error: unknown) => error instanceof RealtimeVoiceError && error.status === 404);
  });

  test("deduplicates transcript chunks and does not retain audio", async () => {
    const { repository, state } = fakeRepository(); let transcriptions = 0;
    const subject = service(repository, { transcribe: async () => { transcriptions += 1; return { text: " 切好的番茄 " }; } });
    const input = { turnId: "turn-a", sequence: 1, audioBase64: "data:audio/webm;base64,YXVkaW8=", mimeType: "audio/webm", final: true };
    assert.equal((await subject.audio(42, state.session.id, input)).transcript, "切好的番茄");
    assert.equal((await subject.audio(42, state.session.id, input)).repeated, true);
    assert.equal(transcriptions, 1);
  });

  test("routes deterministic controls and persistent writes without an Agent Run", async () => {
    const { repository, state } = fakeRepository(); let runs = 0;
    const subject = service(repository, { startRun: async () => { runs += 1; return { run: { id: "unexpected", status: "queued" } }; } });
    const control = await subject.turn(42, state.session.id, { turnId: "turn-control", transcript: "增加5分钟", currentStep: 1, timerSeconds: 0 });
    assert.deepEqual(control.action, { action: "ADD_TIMER", seconds: 300 });
    const confirmation = await subject.turn(42, state.session.id,
      { turnId: "turn-write", transcript: "删除这条库存", currentStep: 1, timerSeconds: 0 });
    assert.equal(confirmation.intent, "confirmation_required");
    assert.equal(confirmation.action?.requiresConfirmation, true);
    const mealPlan = await subject.turn(42, state.session.id,
      { turnId: "turn-meal-plan", transcript: "给我创建一份一周餐单", currentStep: 1, timerSeconds: 0 });
    assert.equal(mealPlan.intent, "confirmation_required");
    assert.equal(runs, 0);
  });

  test("keeps timer continuation distinct from explicit next-step commands", async () => {
    const { repository, state } = fakeRepository(); let runs = 0;
    const subject = service(repository, { startRun: async () => { runs += 1; return { run: { id: "unexpected", status: "queued" } }; } });
    const cases = [
      ["继续计时", "START_TIMER"], ["继续倒计时", "START_TIMER"],
      ["开始倒计时", "START_TIMER"], ["暂停计时", "PAUSE_TIMER"],
      ["继续下一步", "NEXT_STEP"], ["继续", "NEXT_STEP"],
      ["下一步", "NEXT_STEP"], [" 请帮我继续下一步吧。 ", "NEXT_STEP"],
      ["上一步", "PREV_STEP"], ["增加5分钟", "ADD_TIMER"],
    ];
    for (const [transcript, action] of cases) {
      const result = await subject.turn(42, state.session.id,
        { turnId: transcript, transcript, currentStep: 1, timerSeconds: 30 });
      assert.equal(result.intent, "control", transcript);
      assert.equal(result.action?.action, action, transcript);
    }
    assert.equal(runs, 0);
  });

  test("answers questions mentioning next steps or continuation instead of advancing", async () => {
    const { repository, state } = fakeRepository(); let runs = 0;
    const subject = service(repository, { startRun: async () => {
      runs += 1; return { run: { id: `question-${runs}`, status: "queued" } };
    } });
    for (const transcript of ["下一步是什么？", "为什么要继续翻炒？", "继续下一步之前要加盐吗？",
      "现在可以继续吗", "不要继续", "下一步需要什么食材", "继续？"]) {
      const result = await subject.turn(42, state.session.id,
        { turnId: transcript, transcript, currentStep: 1, timerSeconds: 30 });
      assert.equal(result.intent, "question", transcript);
      assert.equal(result.action, undefined, transcript);
    }
    assert.equal(runs, 7);
  });

  test("streams completed answers, cancels barge-ins, and cancels pending work on close", async () => {
    const { repository, state } = fakeRepository(); const cancelled: string[] = [];
    const subject = service(repository, {
      startRun: async (_userId, _input, _priority, onReplyDelta) => {
        await onReplyDelta?.("run-1", "保持中火");
        await onReplyDelta?.("run-1", "翻炒。");
        return { run: { id: "run-1", status: "queued" } };
      },
      cancelRun: async (_userId, runId) => { cancelled.push(runId); },
    });
    const result = await subject.turn(42, state.session.id,
      { turnId: "turn-question", transcript: "现在火候怎么控制", currentStep: 2, timerSeconds: 30, interruptedResponse: true });
    assert.equal(result.intent, "question");
    await waitForImmediate();
    assert.deepEqual(cancelled, ["old-run"]);
    assert.deepEqual(state.events.filter((event) => event.type === "response.text.delta").map((event) => event.payload.delta),
      ["保持中火", "翻炒。"]);
    assert.deepEqual(state.completed, [{ text: "保持中火翻炒。", status: "completed" }]);
    await subject.close(42, state.session.id);
    assert.deepEqual(cancelled, ["old-run", "pending-run"]);
  });

  test("decodes and batches genuine structured model token deltas", async () => {
    const decoder = new StructuredReplyDecoder();
    assert.equal(decoder.push('```json\n{"rep'), "");
    assert.equal(decoder.push('ly":"先加\\u5c1'), "先加");
    assert.equal(decoder.push('1量水。再翻\\n炒。"}'), "少量水。再翻\n炒。");

    const deltas: string[] = [];
    const handler = new StructuredReplyStreamHandler((delta) => { deltas.push(delta); });
    for (const token of ['{"reply":"保持中火。', '翻炒至蛋液凝固；', '立即关火。"}']) {
      await handler.handleLLMNewToken(token);
    }
    await handler.handleLLMEnd();
    assert.deepEqual(deltas, ["保持中火。", "翻炒至蛋液凝固；", "立即关火。"]);

    const modelDeltas: string[] = [];
    const modelHandler = new StructuredReplyStreamHandler((delta) => { modelDeltas.push(delta); });
    const model = new FakeStreamingChatModel({ sleep: 0, chunks: [
      new AIMessageChunk('{"reply":"上游第一句。'),
      new AIMessageChunk('上游第二句。"}'),
    ] });
    const result = await model.invoke("ignored", { callbacks: [modelHandler] });
    assert.equal(result.content, '{"reply":"上游第一句。上游第二句。"}');
    assert.deepEqual(modelDeltas, ["上游第一句。", "上游第二句。"]);
  });

  test("SQLite accepts live deltas only for an active, uncancelled turn and avoids completion duplicates", async () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE realtime_voice_sessions (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, status TEXT NOT NULL,
        expires_at TEXT NOT NULL, first_response_ms INTEGER
      );
      CREATE TABLE realtime_voice_turns (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id INTEGER NOT NULL, agent_run_id TEXT
      );
      CREATE TABLE realtime_voice_events (
        session_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, sequence)
      );
      INSERT INTO realtime_voice_sessions(id,user_id,status,expires_at)
        VALUES('session-1',42,'active',datetime('now','+1 hour'));
      INSERT INTO realtime_voice_turns(id,session_id,user_id,agent_run_id)
        VALUES('turn-1','session-1',42,'run-1');
    `);
    const repository = new SqliteRealtimeVoiceRepository(database);
    assert.equal(await repository.appendResponseDelta({ sessionId: "session-1", userId: 42, turnId: "turn-1",
      runId: "run-1", index: 0, delta: "保持中火。", firstResponseMs: 25 }), true);
    await repository.completeResponse({ sessionId: "session-1", turnId: "turn-1", text: "保持中火。", status: "completed", firstResponseMs: 50 });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM realtime_voice_events WHERE event_type='response.text.delta'")
      .get() as { count: number }).count, 1);
    await repository.emitEvent("session-1", "response.cancelled", { turnId: "turn-1" });
    assert.equal(await repository.appendResponseDelta({ sessionId: "session-1", userId: 42, turnId: "turn-1",
      runId: "run-1", index: 1, delta: "不应写入", firstResponseMs: 25 }), false);
    database.close();
  });
});
