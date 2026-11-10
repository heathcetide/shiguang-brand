import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { FoodDomainError } from "./errors.js";
import type { FoodRepository } from "./repository.js";
import type { CustomFoodCreateData, ExternalFood, FoodLibraryRecord } from "./types.js";

type FoodServiceDependencies = {
  searchExternal: (query: string) => Promise<ExternalFood[]>;
};

function publicFood<T extends object>(food: T): Omit<T, "micronutrients_json"> & { micronutrients: unknown } {
  const { micronutrients_json: micronutrientsJson, base_data_payload: payload, ...result } = food as T & { source?: string; micronutrients_json?: unknown; base_data_payload?: unknown };
  let concept: Record<string, unknown> | null = null;
  try { concept = typeof payload === 'string' ? JSON.parse(payload) : payload as Record<string, unknown> || null; } catch { /* Missing legacy metadata. */ }
  let micronutrients: unknown = null;
  if (typeof micronutrientsJson === "string") {
    try {
      micronutrients = JSON.parse(micronutrientsJson);
    } catch {
      micronutrients = null;
    }
  } else if (micronutrientsJson && typeof micronutrientsJson === "object") {
    micronutrients = micronutrientsJson;
  }
  const conceptBased = result.source === 'concept_base' || Boolean(concept?.concept_id);
  return { ...result, micronutrients: conceptBased ? null : micronutrients,
    ...(concept?.concept_id ? { concept_id: concept.concept_id, forms: concept.forms, aliases: concept.aliases,
      nutrition_references: concept.nutrition_references || [], enrichment_version: concept.enrichment_version,
    } : {}),
    ...(conceptBased ? { calories_100g: null, protein_100g: null, carbs_100g: null, fat_100g: null,
      nutrition_basis: 'unknown', nutrition_status: 'unknown', automatic_calculation_allowed: false, edible_ratio: null } : {}),
  } as Omit<T, "micronutrients_json"> & { micronutrients: unknown };
}

export class FoodService {
  private readonly repository: FoodRepository;
  private readonly dependencies: FoodServiceDependencies;

  constructor(repository: FoodRepository, dependencies: FoodServiceDependencies) {
    this.repository = repository;
    this.dependencies = dependencies;
  }

  findByBarcode(barcode: string) {
    return this.repository.findByBarcode(barcode);
  }

  async search(query: string) {
    const normalizedQuery = normalizeContentTerm(query);
    if (!normalizedQuery) throw new FoodDomainError("搜索词不能为空");

    const localFoods = await this.repository.searchTrusted(normalizedQuery, 10);
    if (localFoods.length >= 5 || localFoods.some(food => food.source === 'concept_base')) return localFoods.map(publicFood);

    if (!localFoods.length) await this.repository.recordSearchGap(normalizedQuery, query);
    const externalFoods = await this.dependencies.searchExternal(query);
    const suggestions = externalFoods.map((food) => ({
      ...food,
      id: null,
      quality_status: "external_unverified",
      cacheable: false,
      requires_review: true,
    }));
    return [...localFoods.map(publicFood), ...suggestions.map(publicFood)].slice(0, 15);
  }

  async createCustom(userId: number, input: CustomFoodCreateData) {
    return {
      success: true,
      id: await this.repository.createCustom(userId, input),
      message: "提交成功，等待管理员审核后将公开",
    };
  }
}
