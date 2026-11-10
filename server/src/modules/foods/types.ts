export type FoodLibraryRecord = {
  id: number;
  name: string;
  category: string | null;
  calories_100g?: number | null;
  protein_100g?: number | null;
  carbs_100g?: number | null;
  fat_100g?: number | null;
  image_url: string | null;
  brands: string | null;
  barcode: string | null;
  original_name?: string | null;
  micronutrients_json?: unknown;
  source?: string | null;
  quality_status?: string;
  source_version?: string | null;
  data_license?: string | null;
  preparation_state?: string;
  nutrition_basis?: string;
  edible_ratio?: number | null;
};

export type CustomFoodCreateData = {
  name: string;
  calories_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
};

export type ExternalFood = {
  name: string;
  calories_100g: number | null;
  protein_100g: number | null;
  carbs_100g: number | null;
  fat_100g: number | null;
  source: string;
  source_provider?: string;
  fdc_id?: number;
  source_url?: string;
  source_data_type?: string | null;
  source_serving_size_unit?: string | null;
  source_published_at?: string | null;
  data_license?: string;
  nutrition_basis?: string;
};
