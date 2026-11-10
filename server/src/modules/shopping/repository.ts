import type { ShoppingItem, ShoppingItemInput, ShoppingItemUpdate } from "./types.js";

/** Driver-neutral persistence port for a user's personal shopping list. */
export interface ShoppingRepository {
  list(userId: number): Promise<ShoppingItem[]>;
  create(id: string, userId: number, input: ShoppingItemInput): Promise<ShoppingItem>;
  update(id: string, userId: number, input: ShoppingItemUpdate): Promise<ShoppingItem | null>;
  remove(id: string, userId: number): Promise<boolean>;
  importItems(userId: number, items: Array<{ id: string; clientId: string; input: ShoppingItemInput }>): Promise<void>;
}
