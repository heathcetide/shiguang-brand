export type AgentModality = "text" | "home" | "cooking" | "image" | "audio" | "inventory_scan" | "receipt";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_input"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type SpecialistName =
  | "Supervisor"
  | "NutritionPlanningAgent"
  | "RecipeCookingAgent"
  | "VisionAgent"
  | "VoiceAgent"
  | "OperationsAgent"
  | "PolicyGate";

export type AgentInput = {
  modality: AgentModality;
  source?: string;
  prompt?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  image?: string;
  audioBase64?: string;
  mediaRef?: string;
  mimeType?: string;
  period?: string;
  idempotencyKey?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type AgentArtifact = {
  type: "text" | "meal_plan" | "shopping_list" | "vision" | "transcript" | "recipes" | "operation";
  title?: string;
  data: unknown;
};

export type AgentActionType =
  | "create_meal_plan"
  | "update_meal_plan"
  | "add_shopping_items"
  | "update_shopping_item"
  | "delete_meal_plan"
  | "delete_shopping_item"
  | "record_diet_meal"
  | "add_inventory_item"
  | "update_inventory_item"
  | "consume_inventory_items"
  | "produce_meal"
  | "record_prepared_meal_event"
  | "add_kitchenware_item"
  | "submit_recipe"
  | "update_kitchen_preferences"
  | "update_recipe_preference"
  | "record_health_log";

export type AgentActionProposal = {
  id?: string;
  actionType: AgentActionType;
  riskLevel: "low" | "high" | "forbidden";
  summary: string;
  payload: Record<string, unknown>;
  version?: number;
};

export type AgentActionBundle = {
  version: number;
  actions: AgentActionProposal[];
  expiresAt: string;
};

export type AgentRunEvent = {
  sequence: number;
  agentName: SpecialistName;
  eventType: string;
  summary: string;
  payload?: unknown;
  createdAt: string;
};

export type AgentRunSummary = {
  id: string;
  sessionId: string;
  modality: AgentModality;
  source: string;
  status: AgentRunStatus;
  reply?: string;
  transcript?: string;
  artifacts: AgentArtifact[];
  pendingApproval?: AgentActionBundle;
  pendingInput?: { question: string };
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
};

export type AgentResponse = {
  mode: "agent";
  run: AgentRunSummary;
  reply?: string;
  transcript?: string;
  artifacts?: AgentArtifact[];
  pendingApproval?: AgentActionBundle;
};
