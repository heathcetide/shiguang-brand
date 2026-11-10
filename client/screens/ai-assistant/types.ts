import type { InventoryFieldEvidence } from "@dietdigidose/contracts";
export interface DietRecordActionCard {
  mealType: string;
  foodName: string;
  amount: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  saved?: boolean;
}

export interface AIWriteConfirmation {
  confirmationId: string;
  action: "record_diet_meal" | "add_inventory_item" | "add_kitchenware_item" | "record_health_log";
  payload: Record<string, unknown>;
  expiresAt: string;
  committed?: boolean;
}

export interface DietRecordMissingCard {
  dishName: string;
  missingIngredients: Array<{ name: string; amount: string }>;
  savedToList?: boolean;
}

export interface DietRecordOptionsCard {
  title: string;
  options: Array<{ label: string; actionText: string }>;
}

export interface SolutionCard {
  id: string;
  recipeId?: number;
  schemeTag: string;
  title: string;
  ingredients: string;
  ingredientItems?: Array<{ name: string; amount: string }>;
  cookingTip: string;
  steps?: string[];
  macros: string;
  actionText: string;
  savedToRecipes?: boolean;
  source?: "local" | "ai";
}

export interface InventoryScanFood {
  fieldEvidence?: InventoryFieldEvidence;
  id: string;
  foodName: string;
  quantity: string;
  suggestedStorageLocation: "冷藏" | "冷冻" | "常温" | "";
  estimatedExpireDays: number | null;
  selected: boolean;
}

export interface InventoryScanCard {
  jobId: string;
  status: "processing" | "review" | "saving" | "saved" | "failed" | "undone";
  canUndo?: boolean;
  items: InventoryScanFood[];
  error?: string;
  lowConfidence?: boolean;
  confidence?: number | null;
}

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_input"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface AgentActionProposal {
  id?: string;
  actionType: string;
  riskLevel: "low" | "high" | "forbidden";
  summary: string;
  payload: Record<string, unknown>;
  version?: number;
}

export interface AgentRunEvent {
  payload?: { delta?: string; [key: string]: unknown };
  sequence: number;
  agentName: "Supervisor" | "NutritionPlanningAgent" | "RecipeCookingAgent" | "VisionAgent" | "VoiceAgent" | "OperationsAgent" | "PolicyGate";
  eventType: string;
  summary: string;
  createdAt: string;
}

export interface AgentRunSummary {
  id: string;
  sessionId: string;
  modality: string;
  source: string;
  status: AgentRunStatus;
  reply?: string;
  transcript?: string;
  artifacts: Array<{ type: string; title?: string; data: unknown }>;
  pendingApproval?: { version: number; actions: AgentActionProposal[]; expiresAt: string };
  pendingInput?: { question: string };
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export type AgentActionState = { id: string; actionType: string; status: string; name: string; undoAvailableUntil?: string };

export interface AgentRunView {
  connectionError?: boolean;
  actions?: AgentActionState[];
  run: AgentRunSummary;
  events: AgentRunEvent[];
  undoState?: "available" | "completed";
}

export interface AgentResponse {
  actions?: AgentActionState[];
  mode: "agent";
  run: AgentRunSummary;
  reply?: string;
  transcript?: string;
  artifacts?: AgentRunSummary["artifacts"];
  solutionCards?: SolutionCard[];
  pendingApproval?: AgentRunSummary["pendingApproval"];
  responseTimeMs?: number;
}

export interface Message {
  id: string;
  sender: "ai" | "user";
  text: string;
  imageUri?: string;
  imageRunId?: string;
  actionCard?: DietRecordActionCard;
  writeConfirmation?: AIWriteConfirmation;
  missingCard?: DietRecordMissingCard;
  optionsCard?: DietRecordOptionsCard;
  solutionCards?: SolutionCard[];
  inventoryScanCard?: InventoryScanCard;
  agentRun?: AgentRunView;
  agentCardsHydrated?: boolean;
  responseTimeMs?: number;
  status?: "completed" | "failed";
  time: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}
