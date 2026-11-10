import { kitchenwareAttributesSchema, type CookingSchedule, type RecipeTaskGraph } from "@dietdigidose/contracts";
import { QuantityDecimal, QuantityPrecisionError } from "@dietdigidose/contracts/quantity-decimal";
import { parseJson } from "../mealPlans/formatters.js";
import type { Row } from "./types.js";

export type ScheduleEntry = { allowedDeviceIds?: number[]; kind?: "cooking" | "reheating"; preparedMealId?: string; targetMealId: string; recipeId: number; servings: number; recipe: {
  title: string; cook_time: number; prep_time: number | null; serving_size: number | null; execution_profile?: (RecipeTaskGraph & { sourceUrl?: string; instructions?: string }) | null;
} };
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
/** Keep decimal remainders exact, including positive tails below the capacity's
 * six-decimal floor. The limit also bounds work before allocating any tasks. */
function splitServings(servings: number, capacity: number, limit: number): number[] | null {
  if (!(capacity > 0)) return null;
  const zero = QuantityDecimal.from(0), maximum = QuantityDecimal.from(capacity);
  let remaining = QuantityDecimal.from(servings);
  const batches: number[] = [];
  while (remaining.compare(zero) > 0) {
    if (batches.length >= limit) return null;
    const portion = remaining.compare(maximum) > 0 ? maximum : remaining;
    batches.push(portion.toNumber());
    remaining = remaining.subtract(portion);
  }
  return batches;
}
/** ponytail: greedy ready-task scheduling, with a 5000-task ceiling. It gives a
 * feasible upper bound; an optimizer is needed only to guarantee the shortest schedule. */
export function scheduleCooking(entries: ScheduleEntry[], owned: Row[]): CookingSchedule {
  const result: CookingSchedule = { complete: false, elapsedMinutes: null, sequentialMinutes: 0, missing: [], conflicts: [], batches: [], tasks: [] };
  const deviceFree = new Map<number, number>(), deviceOwner = new Map<number, string>(), assignedWork = new Map<number, number>();
  const human: Array<{ start: number; end: number }> = [];
  const activeStart = (start: number, minutes: number) => {
    if (minutes === 0) return start;
    for (const interval of [...human].sort((a, b) => a.start - b.start)) if (start < interval.end && start + minutes > interval.start) start = interval.end;
    return start;
  };
  type Node = Omit<CookingSchedule["tasks"][number], "startMinute" | "endMinute"> & { minutes: number };
  const pending: Node[] = [];
  const batchState = new Map<string, { devices: number[]; remaining: number; end: number }>();
  for (const [entryIndex, entry] of entries.entries()) {
    const profile = entry.recipe.execution_profile;
    if (!profile) {
      result.sequentialMinutes += (entry.recipe.cook_time + (entry.recipe.prep_time ?? 0)) * Math.ceil(entry.servings / (entry.recipe.serving_size || 1));
      result.missing.push(`recipe_execution:${entry.recipeId}`); continue;
    }
    const selected: Array<{ key: string; id: number; name: string }> = [];
    let capacity = profile.maxBatchServings;
    for (const tool of [...profile.tools].sort((a, b) => (b.capacity.kind === "volume" ? b.capacity.mlPerServing : 0) - (a.capacity.kind === "volume" ? a.capacity.mlPerServing : 0))) {
      const options = owned.filter(row => (!entry.allowedDeviceIds || entry.allowedDeviceIds.includes(Number(row.id))) && Number(row.catalog_id) === tool.catalogId && !selected.some(item => item.id === Number(row.id))).flatMap(row => {
        const attributes = kitchenwareAttributesSchema.safeParse(parseJson(row.attributes_json, {}));
        if (tool.capacity.kind === "volume" && (!attributes.success || attributes.data.capacityMl == null)) return [];
        return [{ id: Number(row.id), name: String(row.name), capacity: Math.min(profile.maxBatchServings, entry.servings,
          tool.capacity.kind === "volume" ? attributes.data!.capacityMl! / tool.capacity.mlPerServing : profile.maxBatchServings) }];
      }).sort((a, b) => b.capacity - a.capacity || (assignedWork.get(a.id) ?? 0) - (assignedWork.get(b.id) ?? 0) || a.id - b.id);
      if (!options.length) { result.missing.push(`device_or_capacity:${entry.recipeId}:${tool.key}`); break; }
      selected.push({ key: tool.key, id: options[0].id, name: options[0].name });
      capacity = Math.min(capacity, options[0].capacity);
    }
    if (selected.length !== profile.tools.length) {
      result.sequentialMinutes += profile.tasks.reduce((sum, task) => sum + task.minutes, 0) * Math.ceil(entry.servings / profile.maxBatchServings);
      continue;
    }
    capacity = Math.floor(capacity * 1_000_000) / 1_000_000;
    let portions: number[] | null;
    try {
      portions = splitServings(entry.servings, capacity, Math.min(500 - result.batches.length, Math.floor((5000 - pending.length) / profile.tasks.length)));
    } catch (error) {
      if (!(error instanceof QuantityPrecisionError)) throw error;
      result.conflicts.push(`${entry.recipe.title} 的批次份量无法精确保存，请调整份量后重试`); continue;
    }
    if (!portions) {
      result.conflicts.push(`${entry.recipe.title} 的已核实批次容量过小，无法形成可执行排程`); continue;
    }
    const count = portions.length;
    for (const device of selected) assignedWork.set(device.id, (assignedWork.get(device.id) ?? 0) + count * profile.tasks.reduce((sum, task) => sum + task.minutes, 0));
    let previousLeaves: string[] = [];
    for (let batch = 0; batch < count; batch++) {
      const id = `e${entryIndex}:b${batch}`;
      const servings = portions[batch];
      result.batches.push({ id, targetMealId: entry.targetMealId, recipeId: entry.recipeId, servings, ...(entry.kind ? { kind: entry.kind } : {}), ...(entry.preparedMealId ? { preparedMealId: entry.preparedMealId } : {}), reference: profile.reference, ...(profile.sourceUrl ? { sourceUrl: profile.sourceUrl, instructions: profile.instructions } : {}), devices: selected });
      batchState.set(id, { devices: selected.map(device => device.id), remaining: profile.tasks.length, end: 0 });
      for (const task of profile.tasks) pending.push({ id: `${id}:${task.id}`, batchId: id, title: task.title, phase: task.phase,
        active: task.active, minutes: task.minutes, dependsOn: task.dependsOn.length ? task.dependsOn.map(dependency => `${id}:${dependency}`) : previousLeaves,
        deviceIds: task.tools.map(key => selected.find(item => item.key === key)!.id) });
      previousLeaves = profile.tasks.filter(task => !profile.tasks.some(other => other.dependsOn.includes(task.id))).map(task => `${id}:${task.id}`);
      result.sequentialMinutes += profile.tasks.reduce((sum, task) => sum + task.minutes, 0);
    }
  }
  const done = new Map<string, number>();
  while (pending.length) {
    const choices = pending.flatMap((task, index) => {
      const batch = batchState.get(task.batchId)!;
      if (task.dependsOn.some(dependency => !done.has(dependency)) || batch.devices.some(device => deviceOwner.has(device) && deviceOwner.get(device) !== task.batchId)) return [];
      let beginning = Math.max(0, ...task.dependsOn.map(dependency => done.get(dependency)!), ...batch.devices.map(device => deviceFree.get(device) ?? 0));
      if (task.active) beginning = activeStart(beginning, task.minutes);
      return [{ task, index, beginning }];
    }).sort((a, b) => a.beginning - b.beginning || Number(a.task.active) - Number(b.task.active) || a.task.minutes - b.task.minutes || a.index - b.index);
    const chosen = choices[0];
    if (!chosen) throw new Error("Reviewed cooking graph cannot be scheduled");
    const batch = batchState.get(chosen.task.batchId)!;
    for (const device of batch.devices) deviceOwner.set(device, chosen.task.batchId);
    const end = round(chosen.beginning + chosen.task.minutes);
    const { minutes, ...task } = chosen.task;
    result.tasks.push({ ...task, startMinute: chosen.beginning, endMinute: end });
    if (task.active && minutes > 0) human.push({ start: chosen.beginning, end });
    // Tasks within a batch also serialize any shared device, including idle waits.
    for (const device of task.deviceIds) deviceFree.set(device, end);
    done.set(task.id, end); pending.splice(chosen.index, 1); batch.end = Math.max(batch.end, end);
    if (--batch.remaining === 0) for (const device of batch.devices) { deviceOwner.delete(device); deviceFree.set(device, batch.end); }
  }
  result.missing = [...new Set(result.missing)]; result.sequentialMinutes = round(result.sequentialMinutes);
  result.complete = !result.missing.length && !result.conflicts.length;
  result.elapsedMinutes = result.complete ? Math.max(0, ...result.tasks.map(task => task.endMinute)) : null;
  return result;
}
