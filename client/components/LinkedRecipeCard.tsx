import { Text, TouchableOpacity, View, type GestureResponderEvent } from "react-native";

import { RecipeCover } from "@/components/RecipeCover";
import FontAwesome6 from "@/components/ThemedFontAwesome6";

export type LinkedRecipeSummary = {
  id: number;
  title: string;
  image_url: string | null;
  cook_time: number;
  difficulty: string;
  calories: number;
};

export function LinkedRecipeCard({
  recipe,
  compact = false,
  onPress,
}: {
  recipe?: LinkedRecipeSummary | null;
  unavailable?: boolean;
  compact?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
}) {
  if (!recipe) return null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="link"
      accessibilityLabel={`查看关联菜谱 ${recipe.title}`}
      className="mt-3 flex-row overflow-hidden rounded-2xl border border-line bg-background-secondary"
    >
      <RecipeCover
        uri={recipe.image_url}
        className={compact ? "h-[70px] w-[70px]" : "h-24 w-24"}
        placeholderClassName={compact ? "h-[70px] w-[70px]" : "h-24 w-24"}
      />
      <View className="min-w-0 flex-1 justify-center px-3 py-2.5">
        <View className="flex-row items-center">
          <FontAwesome6 name="book-open" size={9} colorClassName="accent-brand" />
          <Text className="ml-1.5 text-[9px] font-black text-brand">关联完整菜谱</Text>
        </View>
        <Text className="mt-1 text-xs font-black text-ink" numberOfLines={compact ? 1 : 2}>{recipe.title}</Text>
        <Text className="mt-1 text-[9px] font-bold text-copy-muted" numberOfLines={1}>
          {recipe.cook_time == null ? '用时未标注' : `${recipe.cook_time} 分钟`} · {recipe.difficulty} · {recipe.calories == null ? '营养待补全' : `${recipe.calories} kcal`}
        </Text>
      </View>
      <View className="items-center justify-center pr-3">
        <FontAwesome6 name="chevron-right" size={9} colorClassName="accent-copy-muted" />
      </View>
    </TouchableOpacity>
  );
}
