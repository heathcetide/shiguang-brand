import { randomUUID } from "node:crypto";

const baseUrl = String(process.env.STAGING_BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) throw new Error("STAGING_BASE_URL is required");
const target = new URL(baseUrl);
const expectedServerGitSha = process.env.EXPECTED_SERVER_GIT_SHA?.trim() || null;
if (expectedServerGitSha && !/^[a-f0-9]{40}$/.test(expectedServerGitSha)) {
  throw new Error("EXPECTED_SERVER_GIT_SHA must be a full lowercase 40-character commit SHA");
}
const startedAt = new Date().toISOString();
let serverVersion = null;
const localDrill = process.env.ALLOW_HTTP === "1" && target.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(target.hostname);
if (target.protocol !== "https:" && !localDrill) {
  throw new Error("STAGING_BASE_URL must use HTTPS (ALLOW_HTTP=1 permits loopback drills only)");
}
if (target.username || target.password || target.search || target.hash) throw new Error("STAGING_BASE_URL cannot contain credentials, query or fragment");

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const identifier = `staging-smoke-${suffix}@example.invalid`;
const password = `Smoke${randomUUID().replaceAll("-", "").slice(0, 14)}9`;
let token = "";
let cleanupToken = "";

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => null);
  const durationMs = Math.round(performance.now() - startedAt);
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  return { body, durationMs, status: response.status };
}

const checks = [];
function checked(name, result) {
  checks.push({ name, status: result.status, durationMs: result.durationMs });
  return result.body;
}

try {
  checked("health", await request("/api/v1/health"));
  const version = checked("version", await request("/api/v1/version", { headers: { "x-client-version": "staging-smoke" } }));
  serverVersion = {
    serverVersion: version?.serverVersion ?? null,
    serverBuildTime: version?.serverBuildTime ?? null,
    serverGitSha: version?.serverGitSha ?? null,
  };
  // Fail before creating an account when this deployment is not the requested candidate.
  if (expectedServerGitSha && serverVersion.serverGitSha !== expectedServerGitSha) {
    throw new Error("Server commit does not match EXPECTED_SERVER_GIT_SHA (missing identity also fails)");
  }

  const registered = checked("register", await request("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ identifier, username: "烟测食友", password }),
  }));
  token = registered.token;
  cleanupToken = registered.token;

  token = "";
  const loggedIn = checked("login", await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  }));
  token = loggedIn.token;

  const expirationDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const created = [];
  for (const [index,foodName] of ["烟测番茄","烟测鸡蛋","烟测胡萝卜"].entries()) {
    created.push(checked(`inventory.create.${index+1}`,await request("/api/v1/inventory", {
      method: "POST",body: JSON.stringify({ food_name: foodName,category: "其他",quantity: "2个",quantity_value: 2,quantity_unit: "piece",expiration_date: expirationDate,storage_location: "冷藏" }),
    })));
  }
  const inventory = created[0];
  const inventoryList = checked("inventory.list", await request("/api/v1/inventory"));
  if (!created.every(item => inventoryList.some(saved => saved.id===item.id))) throw new Error("created inventory items were not readable");
  const recipes = checked("recipes.list", await request("/api/v1/recipes"));
  if (!Array.isArray(recipes) || recipes.length === 0) throw new Error("no approved recipe is available for the smoke test");

  // Synthetic smoke data: production is not evidence that the user ate anything.
  const productionInput = {
    idempotency_key: `staging-production-${suffix}`,
    inventory_consumptions: [{ item_id: inventory.id,version: inventory.version,mode: "amount",amount_value: 1,unit: "piece" }],
    production: { food_name: "烟测备餐",produced_servings: 2,eaten_servings: 0 },
  };
  const made = checked("cooking.produce",await request("/api/v1/diet-records/cooking-completions",{ method: "POST",body: JSON.stringify(productionInput) }));
  if (!made.prepared_meal?.id || made.prepared_meal.remaining_servings!==2 || made.diet_record!==null) throw new Error("production did not preserve two uneaten portions");
  const repeated = checked("cooking.production-retry",await request("/api/v1/diet-records/cooking-completions",{ method: "POST",body: JSON.stringify(productionInput) }));
  if (!repeated.repeated || repeated.prepared_meal?.id!==made.prepared_meal.id) throw new Error("production retry was not idempotent");
  const unread = checked("diet-records.before-eating",await request("/api/v1/diet-records"));
  if (unread.length!==0) throw new Error("production created an unintended intake");
  const mealPath = `/api/v1/diet-records/prepared-meals/${made.prepared_meal.id}/events`;
  const eatingInput = { idempotency_key: `staging-eating-${suffix}`,version: made.prepared_meal.version,type: "eat",servings: 0.5,recorded_at: new Date().toISOString().slice(0,10),meal_type: "午餐" };
  const eaten = checked("prepared.eat",await request(mealPath,{ method: "POST",body: JSON.stringify(eatingInput) }));
  if (eaten.prepared_meal?.remaining_servings!==1.5 || eaten.diet_record?.amount!=="0.5份") throw new Error("actual eating did not consume exactly half a portion");
  const eatingRetry = checked("prepared.eating-retry",await request(mealPath,{ method: "POST",body: JSON.stringify(eatingInput) }));
  if (!eatingRetry.repeated || eatingRetry.diet_record?.id!==eaten.diet_record.id) throw new Error("eating retry duplicated intake");
  const discarded = checked("prepared.discard",await request(mealPath,{ method: "POST",body: JSON.stringify({ idempotency_key: `staging-discard-${suffix}`,version: eaten.prepared_meal.version,type: "discard",servings: 1.5 }) }));
  if (discarded.prepared_meal?.remaining_servings!==0 || discarded.diet_record!==null) throw new Error("discard created intake or left the wrong remainder");
  checked("cooking.old-retry",await request("/api/v1/diet-records/cooking-completions",{ method: "POST",body: JSON.stringify(productionInput) }));
  const meals = checked("prepared.list",await request("/api/v1/diet-records/prepared-meals"));
  if (meals.find(meal => meal.id===made.prepared_meal.id)?.remaining_servings!==0) throw new Error("old retry restored stale prepared portions");
  const dietRecords = checked("diet-records.list",await request("/api/v1/diet-records"));
  if (dietRecords.length!==1 || dietRecords[0].id!==eaten.diet_record.id || dietRecords[0].calories!==null) throw new Error("intake was duplicated or unknown nutrition was fabricated");
  const stock = checked("inventory.after-eating",await request("/api/v1/inventory"));
  if (stock.find(item => item.id===inventory.id)?.quantity_value!==1 || !created.slice(1).every(item => stock.find(saved => saved.id===item.id)?.quantity_value===2)) throw new Error("inventory was consumed more than once or unrelated stock changed");

  checked("account.delete", await request("/api/v1/auth/account", {
    method: "DELETE",
    body: JSON.stringify({ password, confirmation: "DELETE" }),
  }));
  token = "";
  cleanupToken = "";

  console.log(JSON.stringify({ success: true, baseUrl, startedAt, serverVersion, expectedServerGitSha, checks }, null, 2));
} catch (error) {
  let cleanup = { attempted: false,success: false };
  if (token || cleanupToken) {
    token ||= cleanupToken;
    cleanup = { attempted: true,success: false };
    try {
      await request("/api/v1/auth/account", { method: "DELETE",body: JSON.stringify({ password,confirmation: "DELETE" }) });
      cleanup.success = true;
    } catch (cleanupError) {
      cleanup.error = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  // stdout is the machine-readable report; stderr remains diagnostic-only.
  console.log(JSON.stringify({ success: false, baseUrl, startedAt, serverVersion, expectedServerGitSha, checks,cleanup, error: message }, null, 2));
  console.error(`Staging smoke failed: ${message}`);
  if (cleanup.error) console.error(`Staging smoke cleanup failed: ${cleanup.error}`);
  process.exitCode = 1;
}
