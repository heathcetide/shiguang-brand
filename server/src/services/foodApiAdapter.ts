import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import type { ExternalFood } from "../modules/foods/types.js";

/**
 * Adapter for External Food Data APIs
 * Implements fallback and standard conversion logic.
 */

// USDA API requires an API key. We use DEMO_KEY by default which has rate limits.
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';

export type StandardFoodInfo = ExternalFood;

function nutrientValue(nutrients: unknown, ids: number[], unit: string): number | null {
  if (!Array.isArray(nutrients)) return null;
  for (const id of ids) {
    const observation = nutrients.find((nutrient) => nutrient && typeof nutrient === 'object'
      && nutrient.nutrientId === id && typeof nutrient.unitName === 'string'
      && nutrient.unitName.trim().toUpperCase() === unit
      && typeof nutrient.value === 'number' && Number.isFinite(nutrient.value) && nutrient.value >= 0);
    if (observation) return observation.value;
  }
  return null;
}

export async function searchFoodUSDA(query: string): Promise<StandardFoodInfo[]> {
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=${USDA_API_KEY}&pageSize=5`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      console.error('USDA API Error:', response.statusText);
      return [];
    }

    const data: unknown = await response.json();
    const results: StandardFoodInfo[] = [];

    if (data && typeof data === 'object' && 'foods' in data && Array.isArray(data.foods)) {
      for (const item of data.foods) {
        if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.fdcId) || item.fdcId <= 0
          || typeof item.description !== 'string' || !item.description.trim()) continue;
        const sourceType = typeof item.dataType === 'string' ? item.dataType : null;
        const servingUnit = typeof item.servingSizeUnit === 'string' ? item.servingSizeUnit.trim() : null;
        // Branded foods use 100 g or 100 ml according to the provider's serving unit.
        // A volume basis cannot be converted to grams without a food-specific density.
        const basis = sourceType === 'Branded'
          ? servingUnit?.toLowerCase() === 'g' ? 'per_100g' : servingUnit?.toLowerCase() === 'ml' ? 'per_100ml' : 'unknown'
          : ['Foundation', 'SR Legacy', 'Survey (FNDDS)'].includes(sourceType || '') ? 'per_100g' : 'unknown';
        const nutrients = basis === 'per_100g' ? item.foodNutrients : null;
        results.push({
          name: item.description,
          // Foundation Foods may use Atwater specific (2048) or general (2047) energy.
          calories_100g: nutrientValue(nutrients, [1008, 2048, 2047], 'KCAL'),
          protein_100g: nutrientValue(nutrients, [1003], 'G'),
          carbs_100g: nutrientValue(nutrients, [1005], 'G'),
          fat_100g: nutrientValue(nutrients, [1004], 'G'),
          source: 'open_api',
          source_provider: 'usda_fdc',
          fdc_id: item.fdcId,
          source_url: `https://fdc.nal.usda.gov/food-details/${item.fdcId}/nutrients`,
          source_data_type: sourceType,
          source_serving_size_unit: servingUnit,
          source_published_at: typeof item.publishedDate === 'string' ? item.publishedDate
            : typeof item.publicationDate === 'string' ? item.publicationDate : null,
          data_license: 'CC0-1.0',
          nutrition_basis: basis,
        });
      }
    }
    return results;
  } catch (error) {
    console.error('Failed to fetch from USDA:', error);
    return [];
  }
}
