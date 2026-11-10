import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import * as ImagePicker from "expo-image-picker";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { SmartDateInput } from "@/components/SmartDateInput";
import { communityApi, mediaApi, recipesApi, type Recipe } from "@/services/api";
import { RecipeCover } from "@/components/RecipeCover";

const CATEGORIES = ["寻味", "榜单", "活动", "问答"];

export default function PostCreateScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<{ category?: string }>();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState(
    CATEGORIES.includes(params.category || "") ? params.category as string : "寻味"
  );
  const [eventStartAt, setEventStartAt] = useState("");
  const [eventEndAt, setEventEndAt] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [recipePickerVisible, setRecipePickerVisible] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [recipeCandidates, setRecipeCandidates] = useState<Recipe[]>([]);
  const [recipeSearching, setRecipeSearching] = useState(false);
  const [linkedRecipe, setLinkedRecipe] = useState<Recipe | null>(null);
  const [publishing, setPublishing] = useState(false);
  const publishRequestRef = useRef(false);

  useEffect(() => {
    if (!recipePickerVisible) return;
    let active = true;
    const timeout = setTimeout(() => {
      setRecipeSearching(true);
      const query = recipeSearch.trim()
        ? `?search=${encodeURIComponent(recipeSearch.trim())}&pageSize=12`
        : "?pageSize=12";
      void recipesApi.listPage<Recipe>(query)
        .then((result) => {
          if (active) setRecipeCandidates(result.items);
        })
        .catch((error) => {
          if (active) Alert.alert("菜谱加载失败", error instanceof Error ? error.message : "请稍后重试");
        })
        .finally(() => {
          if (active) setRecipeSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [recipePickerVisible, recipeSearch]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 9,
      quality: 0.55,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const newImages = result.assets
      .filter((asset) => asset.base64)
      .map((asset) => `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`);
    setImageUrls((current) => [...current, ...newImages].slice(0, 9));
  };

  const publish = async () => {
    if (publishRequestRef.current) return;
    if (!title.trim() && !content.trim() && !imageUrls.length && !linkedRecipe) {
      Alert.alert("写点什么吧", "添加文字、图片或关联菜谱后即可发布。");
      return;
    }
    if (!isAuthenticated) {
      Alert.alert("登录后发布", "登录后即可把你的美食分享给社区食友。", [
        { text: "取消", style: "cancel" },
        {
          text: "去登录",
          onPress: () => router.push("/login", {
            returnTo: { pathname: "/post-create", params: { category } },
          }),
        },
      ]);
      return;
    }
    if (category === "活动") {
      if (!eventStartAt || !eventEndAt) {
        Alert.alert("补充活动时间", "请填写活动开始和结束日期。");
        return;
      }
      if (new Date(eventEndAt).getTime() < new Date(eventStartAt).getTime()) {
        Alert.alert("日期有误", "活动结束日期不能早于开始日期。");
        return;
      }
    }
    try {
      publishRequestRef.current = true;
      setPublishing(true);
      const storedImageUrls = await Promise.all(imageUrls.map(async (imageUrl) => {
        if (!imageUrl.startsWith("data:")) return imageUrl;
        const uploaded = await mediaApi.uploadImage(authFetch, imageUrl);
        return uploaded.url;
      }));
      const createdPost = await communityApi.createPost(authFetch, {
          content: [title.trim(), content.trim()].filter(Boolean).join("\n"),
          image_urls: storedImageUrls,
          category,
          event_start_at: category === "活动" ? eventStartAt : null,
          event_end_at: category === "活动" ? eventEndAt : null,
          linked_recipe_id: linkedRecipe?.id ?? null,
      });
      router.replace("/post-detail", { id: createdPost.id, published: true });
    } catch (error) {
      Alert.alert("发布失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      publishRequestRef.current = false;
      setPublishing(false);
    }
  };

  return (
    <Screen safeAreaEdges={["top", "left", "right", "bottom"]}>
      <View className="flex-1 bg-surface">
      <View className="h-14 flex-row items-center justify-between px-4">
        <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full active:bg-background-secondary">
          <FontAwesome6 name="arrow-left" size={15} colorClassName="accent-ink" />
        </TouchableOpacity>
        <Text className="absolute left-0 right-0 text-center text-lg font-black text-ink">写动态</Text>
        <TouchableOpacity onPress={publish} disabled={publishing} className="z-10 min-w-16 items-center rounded-full bg-brand-fill px-4 py-2.5 disabled:opacity-60">
          {publishing ? <ActivityIndicator size="small" colorClassName="accent-on-brand" /> : <Text className="text-xs font-black text-white">发布</Text>}
        </TouchableOpacity>
      </View>

      <View className="flex-1 px-5 pt-5">
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="输入标题（可选）"
          placeholderTextColorClassName="accent-copy-muted"
          autoFocus
          className="py-2 text-2xl font-black text-ink"
        />
        {category === "活动" ? (
          <View className="mt-3 rounded-2xl border border-line bg-brand-soft p-3">
            <View className="mb-3 flex-row items-center gap-2">
              <FontAwesome6 name="calendar-check" size={13} colorClassName="accent-brand" />
              <Text className="text-xs font-black text-brand">设置活动周期</Text>
            </View>
            <View className="flex-row gap-3">
              <SmartDateInput
                label="开始日期"
                value={eventStartAt}
                onChange={setEventStartAt}
                placeholder="选择开始日期"
                containerStyle={{ flex: 1 }}
                labelStyle={{ fontSize: 11 }}
              />
              <SmartDateInput
                label="结束日期"
                value={eventEndAt}
                onChange={setEventEndAt}
                placeholder="选择结束日期"
                containerStyle={{ flex: 1 }}
                labelStyle={{ fontSize: 11 }}
              />
            </View>
          </View>
        ) : category === "问答" ? (
          <View className="mt-3 flex-row items-center gap-2 rounded-xl bg-warm-soft px-3 py-2.5">
            <FontAwesome6 name="circle-question" size={12} colorClassName="accent-warm" />
            <Text className="flex-1 text-[10px] leading-4 text-warm">发布后，回答数、专业身份和采纳状态会在问答页展示。</Text>
          </View>
        ) : null}
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder="记录你的美食故事、饮食心得或想问的问题…"
          placeholderTextColorClassName="accent-copy-muted"
          multiline
          textAlignVertical="top"
          className="mt-3 flex-1 py-1 text-lg leading-8 text-ink"
        />
        {imageUrls.length ? (
          <View className="mb-4">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {imageUrls.map((imageUrl, index) => (
                <View key={`${imageUrl.slice(-24)}-${index}`} className="relative overflow-visible rounded-2xl">
                  <Image source={{ uri: imageUrl }} className="h-24 w-24 rounded-2xl" resizeMode="cover" />
                  <View className="absolute left-1 bottom-1 rounded-full bg-black/55 px-1.5 py-0.5"><Text className="text-[10px] font-bold text-white">{index + 1}</Text></View>
                  <TouchableOpacity onPress={() => setImageUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute -right-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60">
                    <FontAwesome6 name="xmark" size={11} colorClassName="accent-on-brand" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {linkedRecipe ? (
          <View className="mb-4 flex-row overflow-hidden rounded-2xl border border-line bg-background-secondary">
            <RecipeCover uri={linkedRecipe.image_url} className="h-20 w-20" placeholderClassName="h-20 w-20" />
            <View className="min-w-0 flex-1 justify-center px-3">
              <Text className="text-[9px] font-black text-brand">将关联完整菜谱</Text>
              <Text className="mt-1 text-xs font-black text-ink" numberOfLines={1}>{linkedRecipe.title}</Text>
              <Text className="mt-1 text-[9px] text-copy-muted">{linkedRecipe.cook_time} 分钟 · {linkedRecipe.difficulty}</Text>
            </View>
            <TouchableOpacity onPress={() => setLinkedRecipe(null)} accessibilityLabel="移除关联菜谱" className="w-11 items-center justify-center">
              <FontAwesome6 name="xmark" size={12} colorClassName="accent-copy-muted" />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View className="border-t border-line bg-surface px-5 py-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-5">
            <TouchableOpacity onPress={pickImage} disabled={imageUrls.length >= 9} className="h-10 w-10 items-center justify-center rounded-xl active:bg-background-secondary disabled:opacity-40">
              <FontAwesome6 name="image" size={20} colorClassName="accent-copy-muted" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCategory((current) => CATEGORIES[(CATEGORIES.indexOf(current) + 1) % CATEGORIES.length])} className="flex-row items-center gap-2 rounded-xl px-2 py-2 active:bg-background-secondary">
              <FontAwesome6 name="hashtag" size={17} colorClassName="accent-copy-muted" />
              <Text className="text-sm font-bold text-copy-muted">{category}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setRecipePickerVisible(true)} className="h-10 w-10 items-center justify-center rounded-xl active:bg-background-secondary" accessibilityLabel="关联菜谱">
              <FontAwesome6 name="book-open" size={18} colorClassName={linkedRecipe ? "accent-brand" : "accent-copy-muted"} />
            </TouchableOpacity>
          </View>
          <Text className="text-xs text-copy-muted">{imageUrls.length}/9 · {content.length + title.length} 字</Text>
        </View>
        <Text className="mt-1 text-[10px] text-copy-muted">最多 9 张图片 · 点击话题可切换发布板块</Text>
      </View>

      <Modal visible={recipePickerVisible} animationType="slide" transparent onRequestClose={() => setRecipePickerVisible(false)}>
        <View className="flex-1 justify-end bg-black/45">
          <View className="max-h-[78%] rounded-t-[30px] bg-surface px-5 pb-8 pt-5">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-lg font-black text-ink">关联公开菜谱</Text>
                <Text className="mt-1 text-[10px] text-copy-muted">每篇动态最多关联一份已公开菜谱</Text>
              </View>
              <TouchableOpacity onPress={() => setRecipePickerVisible(false)} className="h-9 w-9 items-center justify-center rounded-full bg-background-secondary">
                <FontAwesome6 name="xmark" size={13} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            </View>
            <View className="mt-4 flex-row items-center rounded-2xl border border-line bg-background-secondary px-3">
              <FontAwesome6 name="magnifying-glass" size={12} colorClassName="accent-copy-muted" />
              <TextInput
                value={recipeSearch}
                onChangeText={setRecipeSearch}
                placeholder="搜索菜谱名称或食材"
                placeholderTextColorClassName="accent-copy-muted"
                className="ml-2 h-12 flex-1 text-sm text-ink"
              />
              {recipeSearching ? <ActivityIndicator size="small" colorClassName="accent-brand" /> : null}
            </View>
            <ScrollView className="mt-3" keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
              {recipeCandidates.map((recipe) => (
                <TouchableOpacity
                  key={recipe.id}
                  onPress={() => {
                    setLinkedRecipe(recipe);
                    setRecipePickerVisible(false);
                  }}
                  className={`flex-row overflow-hidden rounded-2xl border ${linkedRecipe?.id === recipe.id ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}
                >
                  <RecipeCover uri={recipe.image_url} className="h-20 w-20" placeholderClassName="h-20 w-20" />
                  <View className="min-w-0 flex-1 justify-center px-3">
                    <Text className="text-sm font-black text-ink" numberOfLines={1}>{recipe.title}</Text>
                    <Text className="mt-1 text-[10px] text-copy-muted">{recipe.cook_time} 分钟 · {recipe.difficulty} · {recipe.calories} kcal</Text>
                  </View>
                  {linkedRecipe?.id === recipe.id ? <View className="justify-center pr-3"><FontAwesome6 name="check" size={12} colorClassName="accent-brand" /></View> : null}
                </TouchableOpacity>
              ))}
              {!recipeSearching && recipeCandidates.length === 0 ? (
                <View className="items-center py-10"><Text className="text-xs text-copy-muted">没有找到可公开关联的菜谱</Text></View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      </View>
    </Screen>
  );
}
