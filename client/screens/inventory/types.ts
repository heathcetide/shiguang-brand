import type { InventoryFieldEvidence } from "@dietdigidose/contracts";
export type { InventoryItem } from "@dietdigidose/contracts";

export type StorageLocation = "冷藏" | "冷冻" | "常温";

export interface Recipe {
  id: number;
  title: string;
  description: string;
  image_url: string;
  cook_time: number;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  category: string;
  tags: string[];
  quality_status?: "trusted" | "estimated" | "needs_review";
  nutrition_is_estimated?: boolean;
  ingredients?: Array<{ name: string; amount?: string }>;
  required_kitchenware?: string[];
  optional_kitchenware?: string[];
}

export interface KitchenwareItem {
  attributes?: import("@dietdigidose/contracts").KitchenwareAttributes;
  id: number;
  name: string;
  category: string;
  status: string;
  image_url: string | null;
  note?: string;
  purchase_date?: string;
  last_maintained_at?: string;
}

export interface KitchenwareCatalogItem {
  id: number;
  name: string;
  category: string;
  aliases: string;
  cooking_methods: string;
  care_note: string | null;
}

export interface DetectedFood {
  fieldEvidence?: InventoryFieldEvidence;
  id: string;
  foodName: string;
  quantity: string;
  suggestedStorageLocation: string;
  estimatedExpireDays: number | null;
  selected: boolean;
  source?: "barcode" | "receipt" | "image" | "manual" | "recent";
  confidence?: number | null;
  barcode?: string | null;
  expirationDate?: string;
  missingFields?: string[];
}
