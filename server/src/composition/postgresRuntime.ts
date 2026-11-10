import { PostgresMaintenanceQueueRepository } from "../modules/planMaintenance/postgresQueueRepository.js";
import { PlanMaintenanceService } from "../modules/planMaintenance/service.js";
import { createPlanMaintenanceRouter } from "../modules/planMaintenance/route.js";
import { PostgresPlanMaintenanceRepository } from "../modules/planMaintenance/postgresRepository.js";
import { Pool } from "pg";
import { configureAccessControlService, AccessControlService } from "../modules/accessControl/index.js";
import { PostgresAccessControlRepository } from "../modules/accessControl/postgresRepository.js";
import { configureRateLimitsService, RateLimitsService } from "../modules/rateLimits/index.js";
import { PostgresRateLimitsRepository } from "../modules/rateLimits/postgresRepository.js";
import { createAiContextService } from "../modules/aiContext/index.js";
import { configureAiContextService } from "../modules/aiContext/runtime.js";
import { PostgresAiContextRepository } from "../modules/aiContext/postgresRepository.js";
import { createAIConversationsService } from "../modules/aiConversations/index.js";
import { configureAIConversationsService } from "../modules/aiConversations/runtime.js";
import { PostgresAIConversationsRepository } from "../modules/aiConversations/postgresRepository.js";
import { createAIRuntimeService } from "../modules/aiRuntime/index.js";
import { configureAIRuntimeService } from "../modules/aiRuntime/runtime.js";
import { PostgresAIRuntimeRepository } from "../modules/aiRuntime/postgresRepository.js";
import { createAuthVerificationService } from "../modules/authVerification/index.js";
import { configureAuthVerificationService } from "../modules/authVerification/runtime.js";
import { PostgresAuthVerificationRepository } from "../modules/authVerification/postgresRepository.js";
import { createNotificationsService } from "../modules/notifications/index.js";
import { configureNotificationsService } from "../modules/notifications/runtime.js";
import { PostgresNotificationsRepository } from "../modules/notifications/postgresRepository.js";
import { createAiToolDataService } from "../modules/aiToolData/index.js";
import { PostgresAiToolDataRepository } from "../modules/aiToolData/postgresRepository.js";
import { createAIWriteConfirmationsService } from "../modules/aiWriteConfirmations/index.js";
import { configureAIWriteConfirmationsService } from "../modules/aiWriteConfirmations/runtime.js";
import { PostgresAIWriteConfirmationsRepository } from "../modules/aiWriteConfirmations/postgresRepository.js";
import { createAdminAuditService } from "../modules/adminAudit/index.js";
import { PostgresAdminAuditRepository } from "../modules/adminAudit/postgresRepository.js";
import { configureAdminAuditService } from "../routes/admin/shared.js";
import { createAgentSchedulingService } from "../modules/agentScheduling/index.js";
import { configureAgentSchedulingService } from "../modules/agentScheduling/runtime.js";
import { PostgresAgentSchedulingRepository } from "../modules/agentScheduling/postgresRepository.js";
import { createAgentOperationsService } from "../modules/agentOperations/index.js";
import { configureAgentOperationsService } from "../modules/agentOperations/runtime.js";
import { PostgresAgentOperationsRepository } from "../modules/agentOperations/postgresRepository.js";
import { createAgentRunsService } from "../modules/agentRuns/index.js";
import { configureAgentRunsService } from "../modules/agentRuns/runtime.js";
import { PostgresAgentRunsRepository } from "../modules/agentRuns/postgresRepository.js";
import { configureAgentCheckpointer } from "../modules/agentCheckpoints/runtime.js";
import { createPostgresAgentCheckpointer } from "../modules/agentCheckpoints/postgres.js";
import { configureAiToolDataService } from "../services/aiTools.js";
import { configureRecommendationsService } from "../modules/recommendations/runtime.js";
import { InventoryService } from "../modules/inventory/service.js";
import { PostgresInventoryRepository, consumeInventoryWithPostgresClient } from "../modules/inventory/postgresRepository.js";
import { createInventoryRouter } from "../modules/inventory/route.js";
import { DietRecordsService } from "../modules/dietRecords/service.js";
import { PostgresDietRecordsRepository } from "../modules/dietRecords/postgresRepository.js";
import { createDietRecordsRouter } from "../modules/dietRecords/route.js";
import { HealthService } from "../modules/health/service.js";
import { PostgresHealthRepository } from "../modules/health/postgresRepository.js";
import { createHealthRouter } from "../modules/health/route.js";
import { FoodService } from "../modules/foods/service.js";
import { PostgresFoodRepository } from "../modules/foods/postgresRepository.js";
import { createFoodRouter } from "../modules/foods/route.js";
import { searchFoodUSDA } from "../services/foodApiAdapter.js";
import { CommunityService } from "../modules/community/service.js";
import { PostgresCommunityRepository } from "../modules/community/postgresRepository.js";
import { createCommunityRouter } from "../modules/community/route.js";
import { CookingQueueService } from "../modules/cookingQueue/service.js";
import { PostgresCookingQueueRepository } from "../modules/cookingQueue/postgresRepository.js";
import { createCookingQueueRouter } from "../modules/cookingQueue/route.js";
import { FeedbackService } from "../modules/feedback/service.js";
import { PostgresFeedbackRepository } from "../modules/feedback/postgresRepository.js";
import { createFeedbackRouter } from "../modules/feedback/route.js";
import { createOnboardingRouter } from "../modules/onboarding/route.js";
import { OnboardingService } from "../modules/onboarding/service.js";
import { PostgresOnboardingRepository } from "../modules/onboarding/postgresRepository.js";
import { InsightsService } from "../modules/insights/service.js";
import { PostgresInsightsRepository } from "../modules/insights/postgresRepository.js";
import { createInsightsRouter } from "../modules/insights/route.js";
import { MealPlansService } from "../modules/mealPlans/service.js";
import { PostgresMealPlansRepository } from "../modules/mealPlans/postgresRepository.js";
import { createMealPlansRouter } from "../modules/mealPlans/route.js";
import { ShoppingService } from "../modules/shopping/service.js";
import { PostgresShoppingRepository } from "../modules/shopping/postgresRepository.js";
import { createShoppingRouter } from "../modules/shopping/route.js";
import { KitchenwareService } from "../modules/kitchenware/service.js";
import { PostgresKitchenwareRepository } from "../modules/kitchenware/postgresRepository.js";
import { createKitchenwareRouter } from "../modules/kitchenware/route.js";
import { RecipesService } from "../modules/recipes/service.js";
import { PostgresRecipesRepository } from "../modules/recipes/postgresRepository.js";
import { createRecipesRouter } from "../modules/recipes/route.js";
import { RecommendationsService } from "../modules/recommendations/service.js";
import { PostgresRecommendationsRepository } from "../modules/recommendations/postgresRepository.js";
import { createRecommendationsRouter } from "../modules/recommendations/route.js";
import { RealtimeVoiceService } from "../modules/realtimeVoice/service.js";
import { PostgresRealtimeVoiceRepository } from "../modules/realtimeVoice/postgresRepository.js";
import { createRealtimeVoiceRouter } from "../modules/realtimeVoice/route.js";
import { VoicePacksService } from "../modules/voicePacks/service.js";
import { PostgresVoicePacksRepository } from "../modules/voicePacks/postgresRepository.js";
import { createVoicePacksRouter } from "../modules/voicePacks/route.js";
import { createAdminVoicePackRouter } from "../modules/voicePacks/adminRoute.js";
import { HouseholdsService } from "../modules/households/service.js";
import { PostgresHouseholdsRepository } from "../modules/households/postgresRepository.js";
import { createHouseholdsRouter } from "../modules/households/route.js";
import { AuthAccountService } from "../modules/authAccount/service.js";
import { EmailVerificationService } from "../modules/authAccount/emailVerification.js";
import { verificationMailer } from "../services/verificationMailer.js";
import { PostgresAuthAccountRepository } from "../modules/authAccount/postgresRepository.js";
import { createAuthAccountRouter } from "../modules/authAccount/route.js";
import { MediaCleanupService } from "../modules/mediaCleanup/service.js";
import { PostgresMediaCleanupRepository } from "../modules/mediaCleanup/postgresRepository.js";
import { deleteStoredMediaReferences } from "../services/mediaStorage.js";
import { WorkerRuntime } from "../modules/worker/service.js";
import { PostgresWorkerRepository } from "../modules/worker/postgresRepository.js";
import { buildAdminWorkerRunsRouter } from "../modules/worker/route.js";
import { createAdminRouter } from "../routes/adminRouter.js";
import { createAuthRouter } from "../routes/authRouter.js";
import { createAdminAIConfigRouter } from "../routes/admin/ai-config.js";
import { createAdminAuthServicesRouter } from "../routes/admin/auth-services.js";
import { createAdminMediaCleanupRouter } from "../routes/admin/media-cleanup.js";
import { createAdminNotificationsRouter } from "../routes/admin/notifications.js";
import { createAdminSiteSettingsRouter } from "../routes/admin/site-settings.js";
import { createAdminAgentRunsRouter } from "../modules/adminAgentRuns/route.js";
import { AdminAgentRunsService } from "../modules/adminAgentRuns/service.js";
import { PostgresAdminAgentRunsRepository } from "../modules/adminAgentRuns/postgresRepository.js";
import { createAdminCommunityRouter } from "../modules/adminCommunity/route.js";
import { AdminCommunityService } from "../modules/adminCommunity/service.js";
import { PostgresAdminCommunityRepository } from "../modules/adminCommunity/postgresRepository.js";
import { createAdminConsoleRouter } from "../modules/adminConsole/route.js";
import { AdminConsoleService } from "../modules/adminConsole/service.js";
import { PostgresAdminConsoleRepository } from "../modules/adminConsole/postgresRepository.js";
import { createAdminFoodAssetsRouter } from "../modules/adminFoodAssets/route.js";
import { AdminFoodAssetsService } from "../modules/adminFoodAssets/service.js";
import { PostgresAdminFoodAssetsRepository } from "../modules/adminFoodAssets/postgresRepository.js";
import { createAdminKitchenwareRouter } from "../modules/adminKitchenware/route.js";
import { AdminKitchenwareService } from "../modules/adminKitchenware/service.js";
import { PostgresAdminKitchenwareRepository } from "../modules/adminKitchenware/postgresRepository.js";
import { createAdminRecipesRouter } from "../modules/adminRecipes/route.js";
import { AdminRecipesService } from "../modules/adminRecipes/service.js";
import { PostgresAdminRecipesRepository } from "../modules/adminRecipes/postgresRepository.js";
import { createAdminUsersRouter } from "../modules/adminUsers/route.js";
import { AdminUsersService } from "../modules/adminUsers/service.js";
import { PostgresAdminUsersRepository } from "../modules/adminUsers/postgresRepository.js";
import { getPublicAgentCheckpointState, cancelSupervisorRun, startSupervisorRun, waitForSupervisorRunCompletion } from "../services/agent/runtime.js";
import { transcribeAudio } from "../services/aiService.js";
import aiRoutes from "../routes/ai.js";
import agentRunRoutes from "../routes/agent-runs.js";
import webhookRoutes from "../routes/webhooks.js";
import notificationsRoutes from "../routes/notifications.js";
import mediaRoutes from "../routes/media.js";
import type { ApplicationRuntime, WorkerRuntimeBundle } from "./types.js";

const REQUIRED_TABLES = ["users", "inventory_items", "diet_records", "agent_runs", "worker_task_runs", "media_cleanup_jobs"];

function poolFromEnvironment() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required when DATABASE_DRIVER=postgresql");
  const max = Math.max(1, Number(process.env.DATABASE_POOL_MAX) || 10);
  const connectionTimeoutMillis = Math.max(1_000, Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5_000);
  return new Pool({ connectionString, max, connectionTimeoutMillis });
}

async function assertRuntimeSchema(pool: Pool) {
  const result = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name=ANY($1::text[])`, [REQUIRED_TABLES]);
  const existing = new Set(result.rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));
  if (missing.length) throw new Error(`PostgreSQL schema is not ready; missing tables: ${missing.join(", ")}`);
}

async function configureSharedRuntime(pool: Pool) {
  await assertRuntimeSchema(pool);
  configureAgentCheckpointer(await createPostgresAgentCheckpointer(pool));
  configureAccessControlService(new AccessControlService(new PostgresAccessControlRepository(pool)));
  configureRateLimitsService(new RateLimitsService(new PostgresRateLimitsRepository(pool)));
  configureAiContextService(createAiContextService(new PostgresAiContextRepository(pool)));
  configureAIConversationsService(createAIConversationsService(new PostgresAIConversationsRepository(pool)));
  configureAIRuntimeService(createAIRuntimeService(new PostgresAIRuntimeRepository(pool)));
  configureAuthVerificationService(createAuthVerificationService(new PostgresAuthVerificationRepository(pool)));
  configureNotificationsService(createNotificationsService(new PostgresNotificationsRepository(pool)));
  configureAiToolDataService(createAiToolDataService(new PostgresAiToolDataRepository(pool)));
  configureAIWriteConfirmationsService(createAIWriteConfirmationsService(new PostgresAIWriteConfirmationsRepository(pool)));
  configureAdminAuditService(createAdminAuditService(new PostgresAdminAuditRepository(pool)));
  configureAgentSchedulingService(createAgentSchedulingService(new PostgresAgentSchedulingRepository(pool)));
  configureAgentOperationsService(createAgentOperationsService(new PostgresAgentOperationsRepository(pool)));
  configureAgentRunsService(createAgentRunsService(new PostgresAgentRunsRepository(pool)));
}

export async function initializePostgresApplication(): Promise<ApplicationRuntime> {
  const pool = poolFromEnvironment();
  try {
    await configureSharedRuntime(pool);
    const kitchenware = new KitchenwareService(new PostgresKitchenwareRepository(pool));
    const recommendations = new RecommendationsService(new PostgresRecommendationsRepository(pool), kitchenware);
    configureRecommendationsService(recommendations);
    const community = new CommunityService(new PostgresCommunityRepository(pool));
    const mediaCleanup = new MediaCleanupService(new PostgresMediaCleanupRepository(pool), deleteStoredMediaReferences);
    const workerRepository = new PostgresWorkerRepository(pool);
    const voicePacks = new VoicePacksService(new PostgresVoicePacksRepository(pool));
    const realtimeVoice = new RealtimeVoiceService(new PostgresRealtimeVoiceRepository(pool), {
      transcribe: transcribeAudio,
      startRun: (userId, input, priority, onReplyDelta) =>
        startSupervisorRun(userId, input as Parameters<typeof startSupervisorRun>[1], priority, onReplyDelta),
      waitForRun: waitForSupervisorRunCompletion,
      cancelRun: cancelSupervisorRun,
    });
    const admin = createAdminRouter([
      createAdminAIConfigRouter(),
      createAdminAuthServicesRouter(),
      createAdminUsersRouter(new AdminUsersService(new PostgresAdminUsersRepository(pool))),
      createAdminCommunityRouter(new AdminCommunityService(new PostgresAdminCommunityRepository(pool))),
      createAdminRecipesRouter(new AdminRecipesService(new PostgresAdminRecipesRepository(pool), kitchenware)),
      createAdminKitchenwareRouter(new AdminKitchenwareService(new PostgresAdminKitchenwareRepository(pool))),
      createAdminFoodAssetsRouter(new AdminFoodAssetsService(new PostgresAdminFoodAssetsRepository(pool))),
      createAdminNotificationsRouter(),
      createAdminSiteSettingsRouter(),
      createAdminAgentRunsRouter(new AdminAgentRunsService(new PostgresAdminAgentRunsRepository(pool), getPublicAgentCheckpointState)),
      createAdminMediaCleanupRouter(mediaCleanup),
      createAdminVoicePackRouter(voicePacks),
      buildAdminWorkerRunsRouter(workerRepository),
      createAdminConsoleRouter(new AdminConsoleService(new PostgresAdminConsoleRepository(pool))),
    ]);
    return {
      driver: "postgresql",
      communityService: community,
      onboardingService: new OnboardingService(new PostgresOnboardingRepository(pool)),
      routes: {
        auth: createAuthRouter(createAuthAccountRouter(new AuthAccountService(new PostgresAuthAccountRepository(pool), (jobId) => mediaCleanup.process(jobId)),
          new EmailVerificationService(new PostgresAuthAccountRepository(pool), verificationMailer))),
        webhooks: webhookRoutes,
        inventory: createInventoryRouter(new InventoryService(new PostgresInventoryRepository(pool))),
        dietRecords: createDietRecordsRouter(new DietRecordsService(new PostgresDietRecordsRepository(pool, consumeInventoryWithPostgresClient))),
        healthData: createHealthRouter(new HealthService(new PostgresHealthRepository(pool))),
        recipes: createRecipesRouter(new RecipesService(new PostgresRecipesRepository(pool), kitchenware)),
        foods: createFoodRouter(new FoodService(new PostgresFoodRepository(pool), { searchExternal: searchFoodUSDA })),
        community: createCommunityRouter(community),
        admin,
        realtimeVoice: createRealtimeVoiceRouter(realtimeVoice),
        voicePacks: createVoicePacksRouter(voicePacks),
        ai: aiRoutes,
        agentRuns: agentRunRoutes,
        shopping: createShoppingRouter(new ShoppingService(new PostgresShoppingRepository(pool))),
        cookingQueue: createCookingQueueRouter(new CookingQueueService(new PostgresCookingQueueRepository(pool))),
        mealPlans: createMealPlansRouter(new MealPlansService(new PostgresMealPlansRepository(pool))),
        insights: createInsightsRouter(new InsightsService(new PostgresInsightsRepository(pool))),
        recommendations: createRecommendationsRouter(recommendations),
        planMaintenance: createPlanMaintenanceRouter(new PlanMaintenanceService(new PostgresPlanMaintenanceRepository(pool))),
        kitchenware: createKitchenwareRouter(kitchenware),
        notifications: notificationsRoutes,
        media: mediaRoutes,
        households: createHouseholdsRouter(new HouseholdsService(new PostgresHouseholdsRepository(pool))),
        feedback: createFeedbackRouter(new FeedbackService(new PostgresFeedbackRepository(pool))),
        onboarding: createOnboardingRouter(new OnboardingService(new PostgresOnboardingRepository(pool))),
      },
      close: () => pool.end(),
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export async function initializePostgresWorker(): Promise<WorkerRuntimeBundle> {
  const pool = poolFromEnvironment();
  try {
    await assertRuntimeSchema(pool);
    configureNotificationsService(createNotificationsService(new PostgresNotificationsRepository(pool),new RecommendationsService(new PostgresRecommendationsRepository(pool),new KitchenwareService(new PostgresKitchenwareRepository(pool)))));
    return {
      driver: "postgresql",
      worker: new WorkerRuntime(new PostgresWorkerRepository(pool)),
      maintenanceQueue: new PostgresMaintenanceQueueRepository(pool),
      mediaCleanup: new MediaCleanupService(new PostgresMediaCleanupRepository(pool), deleteStoredMediaReferences),
      close: () => pool.end(),
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
