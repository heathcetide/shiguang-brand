import { recipeExecutionProof } from "../recipes/planExecution.js";
import { recipeDemands } from "../recommendations/quantities.js";
import { ingredient, parseJson, type Row } from "./formatters.js";

/** Keep the captured planned portions when substituting a differently sized recipe. */
export function replacementAllocation(current: Row, replacement: Row) {
  const constraints = parseJson<Row>(current.plan_constraints_json,{});
  const executions = constraints?.executionItems as Record<string,Row> | undefined;
  const allocation = executions?.[String(current.id)];
  const raw = parseJson<unknown>(replacement.ingredients_json,[]);
  if (!allocation) return { ingredients: raw,constraints: null };
  const servings = Number(allocation.servings);
  const yieldSize = Number(replacement.serving_size);
  const ingredients = Array.isArray(raw) ? raw.map(ingredient).filter(value => value !== null) : [];
  const demands = servings>0 ? recipeDemands(ingredients,yieldSize,servings) : null;
  if (!demands || demands.some(demand => !Number.isFinite(demand.amount_value) || Number(demand.amount_value.toFixed(6))<=0)) return null;
  const units: Record<string,string> = { piece: "个",serving: "份",bag: "袋",box: "盒",bottle: "瓶",can: "罐" };
  const scaled = demands.map(demand => ({ name: demand.food_name,amount: `${Number(demand.amount_value.toFixed(6))}${units[demand.unit] ?? demand.unit}` }));
  const { substitution: _previousSubstitution, ...ordinary } = allocation;
  return { ingredients: scaled,constraints: { ...constraints,
    executionItems: { ...executions,[String(current.id)]: { ...ordinary,recipeId: Number(replacement.id),title: String(replacement.title),recipeYield: yieldSize,demands } } as Record<string,Row>,
    executionRecipeKeys: { ...(constraints.executionRecipeKeys as Record<string, unknown> ?? {}), [String(current.id)]: recipeExecutionProof(replacement) },
    executionNeedsRevalidation: true,
  } };
}
