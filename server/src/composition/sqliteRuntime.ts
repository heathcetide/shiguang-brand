import { SqliteMaintenanceQueueRepository } from "../modules/planMaintenance/sqliteQueueRepository.js";
import { PlanMaintenanceService } from "../modules/planMaintenance/service.js";
import { createPlanMaintenanceRouter } from "../modules/planMaintenance/route.js";
import { SqlitePlanMaintenanceRepository } from "../modules/planMaintenance/sqliteRepository.js";
import { createAiContextService } from "../modules/aiContext/index.js";
import { configureAiContextService } from "../modules/aiContext/runtime.js";
import { SqliteAiContextRepository } from "../modules/aiContext/sqliteRepository.js";
import { createAIConversationsService } from "../modules/aiConversations/index.js";
import { configureAIConversationsService } from "../modules/aiConversations/runtime.js";
import { SqliteAIConversationsRepository } from "../modules/aiConversations/sqliteRepository.js";
import { createAIRuntimeService } from "../modules/aiRuntime/index.js";
import { configureAIRuntimeService } from "../modules/aiRuntime/runtime.js";
import { SqliteAIRuntimeRepository } from "../modules/aiRuntime/sqliteRepository.js";
import { createAuthVerificationService } from "../modules/authVerification/index.js";
import { configureAuthVerificationService } from "../modules/authVerification/runtime.js";
import { SqliteAuthVerificationRepository } from "../modules/authVerification/sqliteRepository.js";
import { createNotificationsService } from "../modules/notifications/index.js";
import { configureNotificationsService } from "../modules/notifications/runtime.js";
import { SqliteNotificationsRepository } from "../modules/notifications/sqliteRepository.js";
import { createAiToolDataService } from "../modules/aiToolData/index.js";
import { SqliteAiToolDataRepository } from "../modules/aiToolData/sqliteRepository.js";
import { createAIWriteConfirmationsService } from "../modules/aiWriteConfirmations/index.js";
import { configureAIWriteConfirmationsService } from "../modules/aiWriteConfirmations/runtime.js";
import { SqliteAIWriteConfirmationsRepository } from "../modules/aiWriteConfirmations/sqliteRepository.js";
import { createAdminAuditService } from "../modules/adminAudit/index.js";
import { SqliteAdminAuditRepository } from "../modules/adminAudit/sqliteRepository.js";
import { createAgentSchedulingService } from "../modules/agentScheduling/index.js";
import { configureAgentSchedulingService } from "../modules/agentScheduling/runtime.js";
import { SqliteAgentSchedulingRepository } from "../modules/agentScheduling/sqliteRepository.js";
import { createAgentOperationsService } from "../modules/agentOperations/index.js";
import { configureAgentOperationsService } from "../modules/agentOperations/runtime.js";
import { SqliteAgentOperationsRepository } from "../modules/agentOperations/sqliteRepository.js";
import { configureAgentCheckpointer } from "../modules/agentCheckpoints/runtime.js";
import { createSqliteAgentCheckpointer } from "../modules/agentCheckpoints/sqlite.js";
import { createAgentRunsService } from "../modules/agentRuns/index.js";
import { configureAgentRunsService } from "../modules/agentRuns/runtime.js";
import { SqliteAgentRunsRepository } from "../modules/agentRuns/sqliteRepository.js";
import { createKitchenwareModule } from "../modules/kitchenware/index.js";
import { createRecipesModule } from "../modules/recipes/index.js";
import { createRecommendationsRuntime } from "../modules/recommendations/index.js";
import { configureRecommendationsService } from "../modules/recommendations/runtime.js";
import { createRealtimeVoiceModule } from "../modules/realtimeVoice/index.js";
import { db, initDatabase } from "../storage/db.js";
import { configureAiToolDataService } from "../services/aiTools.js";
import { configureAdminAuditService } from "../routes/admin/shared.js";
import { AccessControlService, configureAccessControlService } from "../modules/accessControl/index.js";
import { SqliteAccessControlRepository } from "../modules/accessControl/sqliteRepository.js";
import { configureRateLimitsService, RateLimitsService } from "../modules/rateLimits/index.js";
import { SqliteRateLimitsRepository } from "../modules/rateLimits/sqliteRepository.js";
import authRoutes from "../routes/auth.js";
import webhookRoutes from "../routes/webhooks.js";
import inventoryRoutes from "../modules/inventory/index.js";
import dietRecordsRoutes from "../modules/dietRecords/index.js";
import healthDataRoutes from "../modules/health/index.js";
import onboardingRoutes, { onboardingService } from "../modules/onboarding/index.js";
import foodsRoutes from "../modules/foods/index.js";
import communityRoutes, { communityService } from "../modules/community/index.js";
import adminRoutes from "../routes/admin.js";
import aiRoutes from "../routes/ai.js";
import agentRunRoutes from "../routes/agent-runs.js";
import shoppingRoutes from "../modules/shopping/index.js";
import cookingQueueRoutes from "../modules/cookingQueue/index.js";
import mealPlanRoutes from "../modules/mealPlans/index.js";
import insightsRoutes from "../modules/insights/index.js";
import voicePackRoutes from "../modules/voicePacks/index.js";
import notificationsRoutes from "../routes/notifications.js";
import mediaRoutes from "../routes/media.js";
import householdRoutes from "../routes/households.js";
import feedbackRoutes from "../modules/feedback/index.js";
import { WorkerRuntime } from "../modules/worker/service.js";
import { SqliteWorkerRepository } from "../modules/worker/sqliteRepository.js";
import { MediaCleanupService } from "../modules/mediaCleanup/service.js";
import { SqliteMediaCleanupRepository } from "../modules/mediaCleanup/sqliteRepository.js";
import { deleteStoredMediaReferences } from "../services/mediaStorage.js";
import type { ApplicationRuntime, WorkerRuntimeBundle } from "./types.js";

let sqliteAgentCheckpointer: ReturnType<typeof createSqliteAgentCheckpointer> | undefined;

export function initializeSqliteApplication(): ApplicationRuntime {
  initDatabase();
  sqliteAgentCheckpointer ||= createSqliteAgentCheckpointer(
    db as unknown as Parameters<typeof createSqliteAgentCheckpointer>[0],
  );
  configureAgentCheckpointer(sqliteAgentCheckpointer);
  configureAccessControlService(new AccessControlService(new SqliteAccessControlRepository(db)));
  configureRateLimitsService(new RateLimitsService(new SqliteRateLimitsRepository(db)));
  configureAiContextService(createAiContextService(new SqliteAiContextRepository(db)));
  configureAIConversationsService(createAIConversationsService(new SqliteAIConversationsRepository(db)));
  configureAIRuntimeService(createAIRuntimeService(new SqliteAIRuntimeRepository(db)));
  configureAuthVerificationService(createAuthVerificationService(new SqliteAuthVerificationRepository(db)));
  configureNotificationsService(createNotificationsService(new SqliteNotificationsRepository(db)));
  configureAiToolDataService(createAiToolDataService(new SqliteAiToolDataRepository(db)));
  configureAIWriteConfirmationsService(createAIWriteConfirmationsService(new SqliteAIWriteConfirmationsRepository(db)));
  configureAdminAuditService(createAdminAuditService(new SqliteAdminAuditRepository(db)));
  configureAgentSchedulingService(createAgentSchedulingService(new SqliteAgentSchedulingRepository(db)));
  configureAgentOperationsService(createAgentOperationsService(new SqliteAgentOperationsRepository(db)));
  configureAgentRunsService(createAgentRunsService(new SqliteAgentRunsRepository(db)));
  const recommendations = createRecommendationsRuntime(db);
  configureRecommendationsService(recommendations.service);
  return {
    driver: "sqlite",
    communityService,
    onboardingService,
    routes: {
      auth: authRoutes,
      webhooks: webhookRoutes,
      inventory: inventoryRoutes,
      dietRecords: dietRecordsRoutes,
      healthData: healthDataRoutes,
      onboarding: onboardingRoutes,
      recipes: createRecipesModule(db),
      foods: foodsRoutes,
      community: communityRoutes,
      admin: adminRoutes,
      realtimeVoice: createRealtimeVoiceModule(db),
      voicePacks: voicePackRoutes,
      ai: aiRoutes,
      agentRuns: agentRunRoutes,
      shopping: shoppingRoutes,
      cookingQueue: cookingQueueRoutes,
      mealPlans: mealPlanRoutes,
      insights: insightsRoutes,
      recommendations: recommendations.routes,
        planMaintenance: createPlanMaintenanceRouter(new PlanMaintenanceService(new SqlitePlanMaintenanceRepository(db))),
      kitchenware: createKitchenwareModule(db),
      notifications: notificationsRoutes,
      media: mediaRoutes,
      households: householdRoutes,
      feedback: feedbackRoutes,
    },
    async close() {},
  };
}

export function initializeSqliteWorker(): WorkerRuntimeBundle {
  initDatabase();
  configureNotificationsService(createNotificationsService(new SqliteNotificationsRepository(db),createRecommendationsRuntime(db).service));
  return {
    driver: "sqlite",
    worker: new WorkerRuntime(new SqliteWorkerRepository(db)),
    maintenanceQueue: new SqliteMaintenanceQueueRepository(db),
    mediaCleanup: new MediaCleanupService(new SqliteMediaCleanupRepository(db), deleteStoredMediaReferences),
    async close() {},
  };
}
