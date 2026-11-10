import { kitchenwareFunctionLabels, kitchenwareAttributesSchema, type KitchenwareAttributes } from "@dietdigidose/contracts";
import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";

export function useKitchenwareAttributesForm() {
  const [kwFunctions, setKwFunctions] = useState<KitchenwareAttributes["functions"]>(null);
  const [kwCapacity, setKwCapacity] = useState("");
  const [kwDiameter, setKwDiameter] = useState("");
  const [kwHeatSources, setKwHeatSources] = useState<KitchenwareAttributes["heatSources"]>(null);

  const reset = (attributes?: KitchenwareAttributes) => {
    setKwFunctions(attributes?.functions ?? null);
    setKwCapacity(attributes?.capacityMl == null ? "" : String(attributes.capacityMl));
    setKwDiameter(attributes?.diameterCm == null ? "" : String(attributes.diameterCm));
    setKwHeatSources(attributes?.heatSources ?? null);
  };
  const parse = () => kitchenwareAttributesSchema.safeParse({
    functions: kwFunctions,
    capacityMl: kwCapacity.trim() ? Number(kwCapacity) : null,
    diameterCm: kwDiameter.trim() ? Number(kwDiameter) : null,
    heatSources: kwHeatSources,
  });
  return { reset, parse, fields: (
      <View className="gap-3">
        <Text className="text-xs font-bold text-copy-muted">已核对规格（可选）</Text>
        <Text className="text-xs text-copy-muted">按设备说明录入；留空或选择未核对不会推断设备规格。</Text>
        <TextInput accessibilityLabel="厨具容量（毫升）" value={kwCapacity} onChangeText={setKwCapacity} keyboardType="decimal-pad" placeholder="容量（毫升，例如 3000）" className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink" />
        <TextInput accessibilityLabel="厨具直径（厘米）" value={kwDiameter} onChangeText={setKwDiameter} keyboardType="decimal-pad" placeholder="直径（厘米，例如 28）" className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink" />
        <Text className="text-xs font-bold text-copy-muted">设备已核实的电器功能</Text>
        <View className="flex-row flex-wrap gap-2">{(Object.keys(kitchenwareFunctionLabels) as Array<keyof typeof kitchenwareFunctionLabels>).map(value => <TouchableOpacity key={value} accessibilityRole="checkbox" accessibilityState={{ checked: kwFunctions?.includes(value) ?? false }} onPress={() => setKwFunctions(current => current?.includes(value) ? current.filter(item => item !== value) : [...(current ?? []), value])} className="rounded-xl border border-line p-2"><Text className="text-ink text-xs">{kwFunctions?.includes(value) ? "✓ " : ""}{kitchenwareFunctionLabels[value]}</Text></TouchableOpacity>)}<TouchableOpacity accessibilityRole="button" onPress={() => setKwFunctions(null)}><Text className="text-copy-muted">{kwFunctions == null ? "✓ " : ""}功能未核对</Text></TouchableOpacity></View>
        <Text className="text-xs font-bold text-copy-muted">兼容热源（多选）</Text>
        {kwHeatSources?.length === 0 && <Text className="text-xs text-copy-muted">已确认不适用上述热源；尚未核对请选“未核对”。</Text>}
        <View className="flex-row flex-wrap gap-2">
          {([{ value: "gas",label: "燃气" },{ value: "induction",label: "电磁炉" },{ value: "electric",label: "电热" }] as const).map(source => <TouchableOpacity key={source.value} accessibilityRole="checkbox" accessibilityState={{ checked: kwHeatSources?.includes(source.value) ?? false }} onPress={() => setKwHeatSources(current => current?.includes(source.value) ? current.filter(value => value !== source.value) : [...(current ?? []),source.value])} className="rounded-xl border border-line bg-canvas px-3 py-2"><Text className="text-xs text-ink">{kwHeatSources?.includes(source.value) ? "✓ " : ""}{source.label}</Text></TouchableOpacity>)}
          <TouchableOpacity onPress={() => setKwHeatSources(null)} className="rounded-xl border border-line bg-canvas px-3 py-2"><Text className="text-xs text-ink">{kwHeatSources == null ? "✓ " : ""}未核对</Text></TouchableOpacity>
        </View>
      </View>
  ) };
}
