import { useState } from "react";
import { Linking, Text, TouchableOpacity, View } from "react-native";

type NutrientKey = "calories" | "protein" | "carbs" | "fat";
type NutritionReference = {
  id: string;
  display_name?: string;
  scope?: string;
  source_kind?: string;
  source_name?: string;
  source_food_id?: string;
  source_url?: string;
  basis?: string;
  nutrients_per_100g?: Partial<Record<NutrientKey, { amount: number | null; unit: string }>>;
};

export type FoodSourceData = {
  source?: string;
  source_provider?: string;
  source_url?: string;
  source_data_type?: string | null;
  nutrition_basis?: string;
  automatic_calculation_allowed?: boolean;
  fdc_id?: number;
  nutrition_references?: NutritionReference[];
};

const nutrientLabels: Record<NutrientKey, string> = { calories: "热量", protein: "蛋白质", carbs: "碳水", fat: "脂肪" };
const dataTypes: Record<string, string> = {
  Foundation: "基础食物资料", "SR Legacy": "标准参考资料", "Survey (FNDDS)": "膳食调查资料", Branded: "品牌食品标签",
};

function SourceLink({ url, label }: { url?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  let valid = false;
  try { valid = !!url && ["https:", "http:"].includes(new URL(url).protocol); } catch { /* Missing or invalid source. */ }
  if (!valid) return <Text className="text-xs text-copy-muted">来源链接未提供</Text>;
  return <View>
    <TouchableOpacity accessibilityRole="link" accessibilityLabel={label} className="min-h-touch justify-center py-2"
      onPress={() => { setFailed(false); void Linking.openURL(url!).catch(() => setFailed(true)); }}>
      <Text className="text-xs font-bold text-brand">{label}</Text>
    </TouchableOpacity>
    {failed ? <Text accessibilityLiveRegion="polite" className="text-xs text-critical">暂时无法打开来源链接</Text> : null}
  </View>;
}

export function FoodSourceDetails({ food }: { food: FoodSourceData }) {
  const [expanded, setExpanded] = useState(false);
  const usda = food.source === "open_api" || food.source_provider === "usda_fdc";
  const basisLabel = food.nutrition_basis === "per_100g" ? "每 100g"
    : food.nutrition_basis === "per_100ml" ? "来源每 100ml · 未换算为 100g" : "计量基准待核对 · 未换算为 100g";
  const references = food.source === "concept_base" ? food.nutrition_references || [] : [];
  if (!usda && !references.length) return null;
  return <View className="border-t border-line px-3.5 pb-2">
    {usda ? <View className="pt-3">
      <Text className="text-xs text-copy-muted">
        USDA · {food.source_data_type ? dataTypes[food.source_data_type] || food.source_data_type : "资料类型未提供"} · {basisLabel} · 待复核
      </Text>
      <SourceLink url={food.source_url} label={`查看 USDA 来源${food.fdc_id ? ` · FDC ${food.fdc_id}` : ""}`} />
    </View> : null}
    {references.length ? <View>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel="形态营养参考"
        className="min-h-touch flex-row items-center justify-between gap-3 py-2" onPress={() => setExpanded(value => !value)}>
        <Text className="text-xs font-bold text-brand">形态营养参考（{references.length}）</Text>
        <Text className="text-xs text-copy-muted">{expanded ? "收起" : "展开"}</Text>
      </TouchableOpacity>
      {expanded ? <View className="gap-3 pb-2">
        <Text className="text-xs leading-5 text-copy-muted">仅适用于注明形态和条件的样品；不会自动绑定整个食材概念，也不会自动填入记餐。</Text>
        {references.map(reference => <View key={reference.id} className="rounded-2xl bg-canvas p-3">
          <Text className="text-sm font-bold text-ink">{reference.display_name || "食材形态参考"}</Text>
          <Text className="mt-1 text-xs leading-5 text-ink">适用范围：{reference.scope || "未提供，需核对"}</Text>
          <Text className="mt-1 text-xs text-copy-muted">{reference.basis === "per_100g_edible_portion" ? "每 100g 可食部" : "每 100g 来源样品"}</Text>
          <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
            {(Object.keys(nutrientLabels) as NutrientKey[]).map(key => {
              const observation = reference.nutrients_per_100g?.[key];
              const value = observation?.amount;
              return <Text key={key} className="text-xs text-ink">
                {nutrientLabels[key]}：{value == null || !Number.isFinite(value) ? "未知" : `${value} ${observation?.unit || (key === "calories" ? "kcal" : "g")}`}
              </Text>;
            })}
          </View>
          <Text className="mt-2 text-xs leading-5 text-copy-muted">来源：{reference.source_kind === "TFDA" ? "台湾食药署" : reference.source_kind === "SR_Legacy" ? "USDA 标准参考资料" : reference.source_kind || "未提供"}</Text>
          <Text className="text-xs leading-5 text-copy-muted">样品：{reference.source_name || "未提供"}{reference.source_food_id ? ` · ${reference.source_food_id}` : ""}</Text>
          <SourceLink url={reference.source_url} label={`查看样品来源：${reference.display_name || reference.source_name || "食材"}`} />
        </View>)}
      </View> : null}
    </View> : null}
  </View>;
}
