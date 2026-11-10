import { randomUUID } from "node:crypto";
import { ShoppingDomainError } from "./errors.js";
import type { ShoppingRepository } from "./repository.js";
import type { ShoppingImportInput, ShoppingItemInput, ShoppingItemUpdate } from "./types.js";

export class ShoppingService {
  private readonly repository: ShoppingRepository;

  constructor(repository: ShoppingRepository) {
    this.repository = repository;
  }

  list(userId: number) {
    return this.repository.list(userId);
  }

  create(userId: number, input: ShoppingItemInput) {
    return this.repository.create(randomUUID(), userId, input);
  }

  async update(id: string, userId: number, input: ShoppingItemUpdate) {
    const item = await this.repository.update(id, userId, input);
    if (!item) {
      throw new ShoppingDomainError(409, "采购项已变化，请刷新后重试", "SHOPPING_ITEM_VERSION_CONFLICT");
    }
    return item;
  }

  async remove(id: string, userId: number) {
    if (!await this.repository.remove(id, userId)) {
      throw new ShoppingDomainError(404, "采购项不存在", "SHOPPING_ITEM_NOT_FOUND");
    }
    return { success: true as const };
  }

  async importItems(userId: number, input: ShoppingImportInput) {
    await this.repository.importItems(userId, input.items.map((item) => ({
      id: randomUUID(),
      clientId: item.clientId || `${input.importKey}:${item.name}:${item.amount}`,
      input: item,
    })));
    return { items: await this.repository.list(userId) };
  }
}
