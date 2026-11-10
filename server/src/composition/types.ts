import type { Router } from "express";
import type { CommunityService } from "../modules/community/service.js";
import type { MediaCleanupService } from "../modules/mediaCleanup/service.js";
import type { WorkerRuntime } from "../modules/worker/service.js";
import type { OnboardingService } from "../modules/onboarding/service.js";

export type DatabaseDriver = "sqlite" | "postgresql";

export type ApplicationRoutes = {
  auth: Router;
  webhooks: Router;
  inventory: Router;
  dietRecords: Router;
  healthData: Router;
  onboarding: Router;
  recipes: Router;
  foods: Router;
  community: Router;
  admin: Router;
  realtimeVoice: Router;
  voicePacks: Router;
  ai: Router;
  agentRuns: Router;
  shopping: Router;
  cookingQueue: Router;
  mealPlans: Router;
  insights: Router;
  recommendations: Router;
  planMaintenance: Router;
  kitchenware: Router;
  notifications: Router;
  media: Router;
  households: Router;
  feedback: Router;
};

export type ApplicationRuntime = {
  driver: DatabaseDriver;
  routes: ApplicationRoutes;
  communityService: Pick<CommunityService, "resolveShare">;
  onboardingService: Pick<OnboardingService, "get" | "saveFailed">;
  close(): Promise<void>;
};

export type WorkerRuntimeBundle = {
  driver: DatabaseDriver;
  worker: WorkerRuntime;
  mediaCleanup: MediaCleanupService;
  maintenanceQueue: import("../modules/planMaintenance/queue.js").MaintenanceQueueRepository;
  close(): Promise<void>;
};
