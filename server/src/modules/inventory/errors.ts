export type InventoryDomainErrorCode =
  | "INVENTORY_NOT_FOUND"
  | "INVENTORY_VERSION_CONFLICT"
  | "SHOPPING_ITEM_CONFLICT"
  | "INVALID_STRUCTURED_QUANTITY"
  | "INVENTORY_UNIT_MISMATCH"
  | "STRUCTURED_QUANTITY_REQUIRED"
  | "INVALID_CONSUMPTION_AMOUNT"
  | "INVENTORY_CONFLICT"
  | "INVENTORY_INSUFFICIENT"
  | "QUANTITY_PRECISION_REQUIRED";

export class InventoryDomainError extends Error {
  public readonly code: InventoryDomainErrorCode;

  constructor(
    code: InventoryDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InventoryDomainError";
    this.code = code;
  }
}
