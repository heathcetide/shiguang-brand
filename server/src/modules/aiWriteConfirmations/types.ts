export type AIWriteAction = "record_diet_meal" | "add_inventory_item" | "add_kitchenware_item" | "record_health_log";

export interface AIWriteConfirmation {
  id: string;
  userId: number;
  action: AIWriteAction;
  payload: Record<string, unknown>;
  status: "preview" | "committed" | "expired" | "cancelled";
  committedResult: Record<string, unknown> | null;
  expiresAt: string;
}

interface PreparedBase {
  action: AIWriteAction;
  message: string;
}

export type PreparedAIWrite =
  | PreparedBase & { kind: "diet"; mealType: string; foodName: string; amount: string; calories: number | null;
    protein: number | null; carbs: number | null; fat: number | null; recordedAt: string; recordedTime: string | null }
  | PreparedBase & { kind: "inventory"; name: string; category: string; location: string; quantity: string; expirationDate: string }
  | PreparedBase & { kind: "kitchenware"; name: string; category: string; status: string; note: string | null }
  | PreparedBase & { kind: "health"; weight: number | null; bodyFat: number | null; waterMl: number | null; recordedDate: string };

export type AIWriteCommitResult =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "committed"; result: Record<string, unknown> }
  | { kind: "repeated"; result: Record<string, unknown> };
