import { Text, TextInput, View } from "react-native";

export function MealProductionFields({ produced, eaten, onProducedChange, onEatenChange }: {
  produced: string; eaten: string; onProducedChange: (value: string) => void; onEatenChange: (value: string) => void;
}) {
  return <View className="w-full gap-3 rounded-2xl bg-background-secondary p-4 my-3">
    <Text className="font-bold text-ink">这次做了多少，自己现在吃多少？</Text>
    <View className="flex-row gap-3">
      <View className="flex-1"><Text className="text-copy-muted text-xs mb-1">制作产出（份）</Text><TextInput accessibilityLabel="制作产出份数" keyboardType="decimal-pad" value={produced} onChangeText={onProducedChange} className="rounded-xl border border-line p-3 text-ink bg-surface" /></View>
      <View className="flex-1"><Text className="text-copy-muted text-xs mb-1">我现在吃（份）</Text><TextInput accessibilityLabel="我现在食用份数" keyboardType="decimal-pad" value={eaten} onChangeText={onEatenChange} className="rounded-xl border border-line p-3 text-ink bg-surface" /></View>
    </View>
    <Text className="text-copy-muted text-xs">其余保存为待吃餐；填 0 表示全部留待吃。多人产出只记录你实际吃的份量。</Text>
  </View>;
}
