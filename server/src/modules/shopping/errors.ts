export class ShoppingDomainError extends Error {
  readonly status: 404 | 409;
  readonly code: "SHOPPING_ITEM_NOT_FOUND" | "SHOPPING_ITEM_VERSION_CONFLICT";

  constructor(status: 404 | 409, message: string, code: ShoppingDomainError["code"]) {
    super(message);
    this.name = "ShoppingDomainError";
    this.status = status;
    this.code = code;
  }
}
