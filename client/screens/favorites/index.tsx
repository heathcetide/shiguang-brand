import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { RecipeCover } from "@/components/RecipeCover";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { recipesApi } from "@/services/api";


type FavoriteRecipe = {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  cook_time: number;
  calories: number;
  difficulty: string;
  category: string;
  nutrition_is_estimated?: boolean;
};

export default function FavoritesScreen() {
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [recipes, setRecipes] = useState<FavoriteRecipe[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFavorites = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await recipesApi.favorites(authFetch);
      setRecipes(Array.isArray(data) ? data : []);
    } catch {
      setRecipes([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch, isAuthenticated]);

  useFocusEffect(useCallback(() => { void fetchFavorites(); }, [fetchFavorites]));

  const removeFavorite = async (recipeId: number) => {
    const previous = recipes;
    setRecipes((current) => current.filter((recipe) => recipe.id !== recipeId));
    try {
      await recipesApi.unfavorite(authFetch, recipeId);
    } catch {
      setRecipes(previous);
    }
  };

  return (
    <Screen>
      <View className="flex-row items-center border-b border-line bg-surface px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full bg-background-secondary">
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
        </TouchableOpacity>
        <View className="ml-3 flex-1">
          <Text className="text-lg font-black text-ink">我的收藏菜谱</Text>
          <Text className="mt-0.5 text-[11px] text-copy-muted">保存灵感，想做的时候随时回来</Text>
        </View>
        {recipes.length > 0 ? (
          <View className="rounded-full bg-brand-soft px-3 py-1.5">
            <Text className="text-xs font-black text-brand">{recipes.length} 道</Text>
          </View>
        ) : null}
      </View>

      {!isAuthenticated ? (
        <View className="flex-1 items-center justify-center px-8">
          <FontAwesome6 name="bookmark" size={30} colorClassName="accent-warm" />
          <Text className="mt-4 text-base font-black text-ink">登录后使用收藏</Text>
          <TouchableOpacity onPress={() => router.push("/login")} className="mt-5 rounded-2xl bg-brand-fill px-7 py-3">
            <Text className="font-bold text-white">前往登录</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator colorClassName="accent-brand" />
        </View>
      ) : recipes.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="h-16 w-16 items-center justify-center rounded-[24px] bg-warm-soft">
            <FontAwesome6 name="bookmark" size={25} colorClassName="accent-warm" />
          </View>
          <Text className="mt-5 text-lg font-black text-ink">还没有收藏菜谱</Text>
          <Text className="mt-2 text-center text-sm leading-6 text-copy-muted">在菜谱详情页点击右上角书签，就会保存在这里。</Text>
          <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-2xl bg-brand-fill px-6 py-3">
            <Text className="font-bold text-white">去发现菜谱</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View className="w-full max-w-[760px] self-center gap-4">
            {recipes.map((recipe) => (
              <TouchableOpacity
                key={recipe.id}
                onPress={() => router.push("/recipe-detail", { id: recipe.id })}
                className="overflow-hidden rounded-[24px] border border-line bg-surface active:opacity-90"
              >
                <View className="h-40 w-full">
                  <RecipeCover
                    uri={recipe.image_url}
                    className="h-full w-full"
                    placeholderClassName="h-full w-full items-center justify-center bg-brand-soft"
                  />
                  <TouchableOpacity
                    onPress={(event) => { event.stopPropagation(); void removeFavorite(recipe.id); }}
                    accessibilityLabel={`取消收藏${recipe.title}`}
                    className="absolute right-3 top-3 h-10 w-10 items-center justify-center rounded-full bg-surface/90"
                  >
                    <FontAwesome6 name="bookmark" size={16} colorClassName="accent-warm" solid />
                  </TouchableOpacity>
                  <View className="absolute bottom-3 left-3 rounded-full bg-brand-fill/90 px-3 py-1">
                    <Text className="text-[10px] font-bold text-white">{recipe.category}</Text>
                  </View>
                </View>
                <View className="p-4">
                  <Text className="text-lg font-black text-ink">{recipe.title}</Text>
                  <Text className="mt-1.5 text-xs leading-5 text-copy-muted" numberOfLines={2}>{recipe.description}</Text>
                  <View className="mt-3 flex-row gap-4">
                    <Text className="text-xs font-bold text-copy-muted">{recipe.cook_time == null ? '用时未标注' : `${recipe.cook_time} 分钟`}</Text>
                    <Text className="text-xs font-bold text-critical">{recipe.calories == null ? '营养待补全' : `${recipe.nutrition_is_estimated ? '约' : ''}${recipe.calories} kcal`}</Text>
                    <Text className="text-xs font-bold text-warm">{recipe.difficulty}</Text>
                  </View>
                  {recipe.nutrition_is_estimated ? <Text className="mt-2 text-[10px] font-bold text-warm">营养估算</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
