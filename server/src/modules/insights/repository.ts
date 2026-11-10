import type {
  ActionableInventory,
  CreateOutcomeResult,
  InventoryOutcomeCreateInput,
  InventoryOutcomeEvent,
  InventoryOutcomeUpdateInput,
  InventoryScope,
  UpdateOutcomeResult,
} from "./types.js";

/** Driver-neutral persistence port for inventory outcome traces and weekly reports. */
export interface InsightsRepository {
  createOutcome(userId: number, input: InventoryOutcomeCreateInput): Promise<CreateOutcomeResult>;
  updateOutcome(userId: number, eventId: string, input: InventoryOutcomeUpdateInput): Promise<UpdateOutcomeResult>;
  isHouseholdMember(householdId: number, userId: number): Promise<boolean>;
  listEvents(scope: InventoryScope, ownerId: number, from: string, to: string): Promise<InventoryOutcomeEvent[]>;
  findActionable(scope: InventoryScope, ownerId: number, weekStart: string): Promise<ActionableInventory>;
}
