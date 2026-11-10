import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];
const moduleSpecs = [
  {
    name: "adminAgentRuns",
    concreteRepository: /sqliteRepository|SqliteAdminAgentRunsRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminAgentRuns/index.js",
    legacyFile: "server/src/routes/admin/agent-runs.ts",
  },
  {
    name: "aiConversations",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAIConversationsRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/aiConversations/index.js",
    legacyFile: null,
  },
  {
    name: "aiWriteConfirmations",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAIWriteConfirmationsRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/aiWriteConfirmations/index.js",
    legacyFile: "server/src/services/aiWriteConfirmations.ts",
  },
  {
    name: "realtimeVoice",
    concreteRepository: /sqliteRepository|SqliteRealtimeVoiceRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/realtimeVoice/index.js",
    legacyFile: "server/src/routes/realtime-voice.ts",
  },
  {
    name: "notifications",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteNotificationsRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/notifications/index.js",
    legacyFile: null,
  },
  {
    name: "authVerification",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAuthVerificationRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/authVerification/index.js",
    legacyFile: null,
  },
  {
    name: "aiRuntime",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAIRuntimeRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/aiRuntime/index.js",
    legacyFile: null,
  },
  {
    name: "aiContext",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAiContextRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/aiContext/index.js",
    legacyFile: null,
  },
  {
    name: "adminAudit",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAdminAuditRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/adminAudit/index.js",
    legacyFile: null,
  },
  {
    name: "aiToolData",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAiToolDataRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/aiToolData/index.js",
    legacyFile: null,
  },
  {
    name: "mediaCleanup",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteMediaCleanupRepository/,
    compositionFile: "server/src/composition/postgresRuntime.ts",
    compositionImport: "../modules/mediaCleanup/postgresRepository.js",
    legacyFile: null,
    extraLegacyFiles: ["server/src/services/mediaCleanup.ts"],
  },
  {
    name: "rateLimits",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteRateLimitsRepository/,
    compositionFile: "server/src/middleware/sharedRateLimit.ts",
    compositionImport: "../modules/rateLimits/index.js",
    extraCompositions: [{
      file: "server/src/middleware/loginRateLimit.ts",
      import: "../modules/rateLimits/index.js",
    }],
    legacyFile: null,
  },
  {
    name: "accessControl",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAccessControlRepository/,
    compositionFile: "server/src/middleware/auth.ts",
    compositionImport: "../modules/accessControl/index.js",
    legacyFile: null,
    extraLegacyFiles: ["server/src/services/sessionTokens.ts", "server/src/services/userInitialization.ts"],
  },
  {
    name: "authAccount",
    concreteRepository: /sqliteRepository|SqliteAuthAccountRepository/,
    compositionFile: "server/src/routes/auth.ts",
    compositionImport: "../modules/authAccount/index.js",
    legacyFile: null,
  },
  {
    name: "community",
    concreteRepository: /sqliteRepository|SqliteCommunityRepository/,
    compositionFile: "server/src/routes/community.ts",
    compositionImport: "../modules/community/index.js",
    legacyFile: null,
  },
  {
    name: "cookingQueue",
    concreteRepository: /sqliteRepository|SqliteCookingQueueRepository/,
    legacyFile: "server/src/routes/cooking-queue.ts",
  },
  {
    name: "dietRecords",
    concreteRepository: /sqliteRepository|SqliteDietRecordsRepository/,
    legacyFile: "server/src/routes/diet-records.ts",
  },
  { name: "inventory", concreteRepository: /sqliteRepository|SqliteInventoryRepository/ },
  {
    name: "voicePacks",
    concreteRepository: /sqliteRepository|SqliteVoicePacksRepository/,
    legacyFile: "server/src/routes/voice-packs.ts",
    extraLegacyFiles: ["server/src/routes/admin/voice-packs.ts", "server/src/services/voicePacks.ts"],
  },
  {
    name: "kitchenware",
    concreteRepository: /sqliteRepository|SqliteKitchenwareRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/kitchenware/index.js",
    legacyFile: "server/src/routes/kitchenware.ts",
  },
  {
    name: "recommendations",
    concreteRepository: /sqliteRepository|SqliteRecommendationsRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/recommendations/index.js",
    legacyFile: "server/src/routes/recommendations.ts",
    extraLegacyFiles: ["server/src/services/recipeRecommendations.ts"],
  },
  {
    name: "recipes",
    concreteRepository: /sqliteRepository|SqliteRecipesRepository/,
    compositionFile: "server/src/composition/sqliteRuntime.ts",
    compositionImport: "../modules/recipes/index.js",
    legacyFile: "server/src/routes/recipes.ts",
  },
  {
    name: "adminRecipes",
    concreteRepository: /sqliteRepository|SqliteAdminRecipesRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminRecipes/index.js",
    legacyFile: "server/src/routes/admin/recipes.ts",
  },
  {
    name: "adminKitchenware",
    concreteRepository: /sqliteRepository|SqliteAdminKitchenwareRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminKitchenware/index.js",
  },
  {
    name: "adminFoodAssets",
    concreteRepository: /sqliteRepository|SqliteAdminFoodAssetsRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminFoodAssets/index.js",
    legacyFile: "server/src/routes/admin/assets.ts",
  },
  {
    name: "adminConsole",
    concreteRepository: /sqliteRepository|SqliteAdminConsoleRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminConsole/index.js",
  },
  {
    name: "adminCommunity",
    concreteRepository: /sqliteRepository|SqliteAdminCommunityRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminCommunity/index.js",
    legacyFile: "server/src/routes/admin/community.ts",
  },
  {
    name: "adminUsers",
    concreteRepository: /sqliteRepository|SqliteAdminUsersRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminUsers/index.js",
    legacyFile: "server/src/routes/admin/users.ts",
    extraLegacyFiles: ["server/src/routes/admin/user-level-rule.ts", "server/src/services/userLevel.ts"],
  },
  {
    name: "mealPlans",
    concreteRepository: /sqliteRepository|SqliteMealPlansRepository/,
    legacyFile: "server/src/routes/meal-plans.ts",
  },
  {
    name: "households",
    concreteRepository: /sqliteRepository|SqliteHouseholdsRepository/,
    compositionFile: "server/src/routes/households.ts",
    compositionImport: "../modules/households/index.js",
    legacyFile: null,
  },
  {
    name: "insights",
    concreteRepository: /sqliteRepository|SqliteInsightsRepository/,
    legacyFile: "server/src/routes/insights.ts",
  },
  { name: "feedback", concreteRepository: /sqliteRepository|SqliteFeedbackRepository/ },
  { name: "foods", concreteRepository: /sqliteRepository|SqliteFoodRepository/ },
  {
    name: "health",
    concreteRepository: /sqliteRepository|SqliteHealthRepository/,
    legacyFile: "server/src/routes/health-data.ts",
  },
  {
    name: "shopping",
    concreteRepository: /sqliteRepository|SqliteShoppingRepository/,
    legacyFile: "server/src/routes/shopping-list.ts",
  },
  {
    name: "worker",
    concreteRepository: /sqliteRepository|SqliteWorkerRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/worker/index.js",
    legacyFile: "server/src/routes/admin/worker-runs.ts",
  },
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function read(moduleName, fileName) {
  return fs.readFileSync(path.join(root, "server", "src", "modules", moduleName, fileName), "utf8");
}

function reject(moduleName, fileName, patterns) {
  const source = read(moduleName, fileName);
  for (const [label, pattern] of patterns) {
    if (pattern.test(source)) failures.push(`${moduleName}/${fileName} must not depend on ${label}`);
  }
}

const persistencePatterns = [
  ["the SQLite driver", /better-sqlite3/],
  ["the database singleton", /storage\/db|\bdb\s*\./],
  ["raw SQL execution", /\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET)/i],
];

for (const entryPoint of ["server/src/app.ts", "server/src/worker.ts"]) {
  const source = fs.readFileSync(path.join(root, entryPoint), "utf8");
  if (/storage\/db|better-sqlite3|\bdb\s*\./.test(source)) {
    failures.push(`${entryPoint} must use the database composition root instead of a concrete SQLite runtime`);
  }
}

for (const spec of moduleSpecs) {
  if (spec.routeFile !== null) {
    reject(spec.name, spec.routeFile || "route.ts", [
      ...persistencePatterns,
      ["a concrete repository", spec.concreteRepository],
    ]);
  }
  reject(spec.name, "service.ts", [
    ...persistencePatterns,
    ["a concrete repository", spec.concreteRepository],
  ]);
  reject(spec.name, "repository.ts", persistencePatterns);
  const compositionFile = spec.compositionFile || "server/src/composition/sqliteRuntime.ts";
  const compositionImport = spec.compositionImport || `../modules/${spec.name}/index.js`;
  const compositionSource = fs.readFileSync(path.join(root, compositionFile), "utf8");
  if (!compositionSource.includes(compositionImport)) {
    failures.push(`${compositionFile} must compose the ${spec.name} module entry point`);
  }
  for (const composition of spec.extraCompositions || []) {
    const source = fs.readFileSync(path.join(root, composition.file), "utf8");
    if (!source.includes(composition.import)) {
      failures.push(`${composition.file} must compose the ${spec.name} module entry point`);
    }
  }
  const postgresRepository = path.join(root, "server", "src", "modules", spec.name, "postgresRepository.ts");
  if (fs.existsSync(postgresRepository)) {
    const postgresComposition = fs.readFileSync(path.join(root, "server/src/composition/postgresRuntime.ts"), "utf8");
    if (!postgresComposition.includes(`../modules/${spec.name}/postgresRepository.js`)) {
      failures.push(`server/src/composition/postgresRuntime.ts must compose the ${spec.name} PostgreSQL repository`);
    }
  }
  const legacyFile = Object.hasOwn(spec, "legacyFile") ? spec.legacyFile : `server/src/routes/${spec.name}.ts`;
  if (legacyFile && fs.existsSync(path.join(root, legacyFile))) {
    failures.push(`legacy ${spec.name} route must stay removed`);
  }
  for (const extraLegacyFile of spec.extraLegacyFiles || []) {
    if (fs.existsSync(path.join(root, extraLegacyFile))) failures.push(`legacy ${extraLegacyFile} must stay removed`);
  }
}

const businessRoots = ["routes", "services", "modules"].map((name) => path.join(root, "server", "src", name));
const concreteCloudSdk = /from\s+["'](?:@supabase\/supabase-js|@alicloud\/[^"']+)["']/;
for (const file of businessRoots.flatMap(walk).filter((name) => name.endsWith(".ts"))) {
  if (concreteCloudSdk.test(fs.readFileSync(file, "utf8"))) {
    failures.push(`${path.relative(root, file)} must depend on a provider interface, not a cloud SDK`);
  }
}

if (failures.length) {
  console.error(`Module boundary violations:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Module boundaries are valid (domain layers and provider SDK isolation).");
}
