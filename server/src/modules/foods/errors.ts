export class FoodDomainError extends Error {
  readonly code: "INVALID_FOOD_QUERY";

  constructor(message: string) {
    super(message);
    this.name = "FoodDomainError";
    this.code = "INVALID_FOOD_QUERY";
  }
}
