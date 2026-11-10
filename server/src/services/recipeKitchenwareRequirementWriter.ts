export type ResolvedKitchenware = {
  id: number;
  name: string;
  confidence: number;
};

export type RecipeKitchenwareWriteResult = {
  mapped: Array<{
    rawName: string;
    catalogId: number;
    catalogName: string;
    confidence: number;
  }>;
  unresolved: string[];
};

type WriteOptions = {
  replace: boolean;
  resolve: (rawName: string) => ResolvedKitchenware | null;
  enqueueReview: (rawName: string, confidence: number) => void;
  isAvailable: () => boolean;
  prepareRemove: () => () => void;
  prepareInsert: () => (resolved: ResolvedKitchenware, rawName: string) => boolean;
  runAtomically: <T>(operation: () => T) => T;
};

function isSchemaDriftError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("no such table") ||
    message.includes("no such column") ||
    message.includes("has no column named")
  );
}

export function writeRecipeKitchenwareRequirements(
  names: string[],
  options: WriteOptions,
): RecipeKitchenwareWriteResult {
  const normalizedNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const unavailable = { mapped: [], unresolved: normalizedNames };
  if (!options.isAvailable()) return unavailable;

  try {
    const remove = options.replace ? options.prepareRemove() : null;
    const insert = normalizedNames.length ? options.prepareInsert() : null;

    return options.runAtomically(() => {
      const result: RecipeKitchenwareWriteResult = { mapped: [], unresolved: [] };
      remove?.();

      for (const rawName of normalizedNames) {
        const resolved = options.resolve(rawName);
        if (!resolved || resolved.confidence < 1) {
          options.enqueueReview(rawName, resolved?.confidence || 0);
          result.unresolved.push(rawName);
          continue;
        }

        if (!insert?.(resolved, rawName)) {
          throw new Error(`厨具需求未写入：${rawName}`);
        }
        result.mapped.push({
          rawName,
          catalogId: resolved.id,
          catalogName: resolved.name,
          confidence: resolved.confidence,
        });
      }
      return result;
    });
  } catch (error) {
    if (isSchemaDriftError(error)) return unavailable;
    throw error;
  }
}
