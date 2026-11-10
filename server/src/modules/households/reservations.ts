import type { HouseholdMealReservationInput } from "@dietdigidose/contracts";
import { roundServings } from "../dietRecords/preparedMeals.js";
import { HouseholdsError } from "./errors.js";
import type { Row } from "./types.js";
export function reservationTotals(rows: Row[],membershipId: number) {
  return { total: roundServings(rows.reduce((sum,row) => sum+Number(row.servings),0)),mine: roundServings(Number(rows.find(row => Number(row.membership_id) === membershipId)?.servings ?? 0)) };
}
export function validateReservation(meal: Row,input: HouseholdMealReservationInput,totals: { total: number; mine: number }) {
  if (Number(meal.version) !== input.version) throw new HouseholdsError(409,"家庭批次已变化，请刷新后重试","MEAL_VERSION_CONFLICT");
  if (input.servings > roundServings(Number(meal.remaining_servings)-totals.total+totals.mine)) throw new HouseholdsError(409,"可预留份量不足，不能占用其他成员的预留","MEAL_RESERVED");
}
