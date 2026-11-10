// Run against an isolated test account. Credentials never appear in the report.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.AI_BENCHMARK_URL?.replace(/\/$/, '');
const token = process.env.AI_BENCHMARK_TOKEN;
const label = process.env.AI_BENCHMARK_LABEL;
const sampleCount = Number(process.env.AI_BENCHMARK_SAMPLES || 5);
if (!base || !token || !label || !Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) {
  throw new Error('Set AI_BENCHMARK_URL (origin), AI_BENCHMARK_TOKEN, AI_BENCHMARK_LABEL and optionally AI_BENCHMARK_SAMPLES (1–100).');
}
const cases = [
  { id: 'greeting', prompt: '你好！请用一句话介绍你能提供的帮助。不要创建或保存业务记录。' },
  { id: 'cooking', prompt: '番茄炒蛋怎样避免鸡蛋过老？只给烹饪建议，不保存任何业务记录。' },
  { id: 'inventory', prompt: '查询我现有的库存，概括有哪些食材。只查询，不修改任何记录。' },
];
const rows = [];
async function request(path, body) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
for (const fixture of cases) {
  for (let sample = 0; sample < sampleCount; sample++) {
    const start = performance.now();
    let runId;
    const events = new Map();
    let firstVisibleReplyMs = null;
    let cursor = 0;
    try {
      let snapshot = await request('/ai/chat', { prompt: fixture.prompt, source: 'assistant', sessionId: randomUUID(), idempotencyKey: randomUUID() });
      runId = snapshot.run.id;
      while (true) {
        snapshot = await request(`/ai/agent-runs/${runId}?afterSequence=${cursor}`);
        for (const event of snapshot.events || []) { events.set(event.sequence, event); cursor = Math.max(cursor, event.sequence); }
        if (snapshot.run.reply && firstVisibleReplyMs === null) firstVisibleReplyMs = performance.now() - start;
        if (!['queued', 'running'].includes(snapshot.run.status)) break;
        if (performance.now() - start > 330_000) throw new Error('client_timeout');
        await delay(250);
      }
      const allEvents = [...events.values()];
      const starts = allEvents.filter((event) => event.eventType === 'model_call_started');
      const tokens = allEvents.filter((event) => event.eventType === 'model_first_token');
      rows.push({ case: fixture.id, sample, runId, status: snapshot.run.status,
        modelCalls: starts.length || null, retries: allEvents.filter((event) => event.eventType === 'model_retry').length,
        firstModelTokenMs: tokens.length ? Math.min(...tokens.map((event) => Number(event.payload?.latencyMs))) : null,
        firstVisibleReplyMs, elapsedMs: performance.now() - start });
    } catch (error) {
      rows.push({ case: fixture.id, sample, runId, status: 'measurement_failed', error: error.message, elapsedMs: performance.now() - start });
    }
  }
}
function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}
const summary = cases.map(({ id }) => {
  const samples = rows.filter((row) => row.case === id);
  const successes = samples.filter((row) => row.status === 'completed');
  return { case: id, samples: samples.length, successes: successes.length, successRate: successes.length / samples.length,
    p50Ms: percentile(successes.map((row) => row.elapsedMs), .5), p95Ms: percentile(successes.map((row) => row.elapsedMs), .95) };
});
const report = { label, measuredAt: new Date().toISOString(), notes: ['250ms polling adds measurement delay.', 'Null model metrics mean unavailable, never zero. Model TTFT is per call, not user-visible latency.', 'Only read-only text cases run automatically. Use the acceptance matrix for media, approvals, continuity and recovery.'], summary, rows };
await writeFile(process.env.AI_BENCHMARK_OUTPUT || '/tmp/diet-ai-benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
