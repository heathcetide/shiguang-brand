import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import * as ImagePicker from "expo-image-picker";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { recipesApi } from "@/services/api";

type IngredientGroup = "主料" | "辅料" | "调味料";
type IngredientInput = { name: string; amount: string; group: IngredientGroup };
type NutritionInput = { key?: string; label: string; value: string; unit: string };
type RecipeStatus = "pending" | "approved" | "rejected";

interface MyRecipe {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  cook_time: number;
  prep_time?: number | null;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  nutrition?: Array<{ key: string; label: string; value: number; unit: string }>;
  category: string;
  tags: string[];
  steps: string[];
  ingredients: IngredientInput[];
  status: RecipeStatus;
  reject_reason: string | null;
  updated_at: string;
}

const CATEGORIES = ["减脂餐", "增肌餐", "低碳水", "高蛋白", "快手菜", "家常菜"];
const DIFFICULTIES = ["简单", "中等", "较难"];
const INGREDIENT_GROUPS: IngredientGroup[] = ["主料", "辅料", "调味料"];

const emptyForm = () => ({
  title: "",
  description: "",
  imageUrl: "",
  cookTime: "",
  prepTime: "",
  difficulty: "简单",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  nutritionExtras: [] as NutritionInput[],
  category: "家常菜",
  tags: "",
  ingredients: [{ name: "", amount: "", group: "主料" }] as IngredientInput[],
  steps: [""],
});

export default function RecipeSubmitScreen() {
  const router = useSafeRouter();
  const { isAuthenticated, token } = useAuth();
  const authFetch = useAuthFetch();
  const [activeTab, setActiveTab] = useState<"submit" | "mine">("submit");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMine, setLoadingMine] = useState(false);
  const [myRecipes, setMyRecipes] = useState<MyRecipe[]>([]);

  const fetchMine = useCallback(async () => {
    if (!token) return;
    try {
      setLoadingMine(true);
      const data = await recipesApi.mine<MyRecipe>(authFetch);
      setMyRecipes(Array.isArray(data) ? data : []);
    } catch (error) {
      Alert.alert("加载失败", error instanceof Error ? error.message : "暂时无法获取投稿");
    } finally {
      setLoadingMine(false);
    }
  }, [authFetch, token]);

  useEffect(() => {
    if (activeTab === "mine") fetchMine();
  }, [activeTab, fetchMine]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    if (!asset.base64) {
      Alert.alert("图片读取失败", "请重新选择图片");
      return;
    }
    setForm((current) => ({
      ...current,
      imageUrl: `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`,
    }));
  };

  const submit = async () => {
    const ingredients = form.ingredients
      .map((item) => ({ name: item.name.trim(), amount: item.amount.trim(), group: item.group }))
      .filter((item) => item.name);
    const steps = form.steps.map((item) => item.trim()).filter(Boolean);
    if (form.title.trim().length < 2) {
      Alert.alert("请完善食谱", "食谱标题至少需要 2 个字符");
      return;
    }
    if (!ingredients.length || !steps.length) {
      Alert.alert("请完善食谱", "至少填写一种食材和一个烹饪步骤");
      return;
    }

    try {
      setSubmitting(true);
      const data = await recipesApi.submit(authFetch, {
          title: form.title.trim(),
          description: form.description.trim(),
          image_url: form.imageUrl,
          cook_time: form.cookTime,
          prep_time: form.prepTime,
          difficulty: form.difficulty,
          calories: Number(form.calories) || 0,
          protein: Number(form.protein) || 0,
          carbs: Number(form.carbs) || 0,
          fat: Number(form.fat) || 0,
          nutrition: form.nutritionExtras
            .map((item) => ({
              key: item.key,
              label: item.label.trim(),
              value: Number(item.value),
              unit: item.unit.trim() || "g",
            }))
            .filter((item) => item.label && Number.isFinite(item.value) && item.value >= 0),
          category: form.category,
          tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
          ingredients,
          steps,
      }, editingId || undefined);

      Alert.alert("提交成功", data.message || "食谱已进入审核");
      setForm(emptyForm());
      setEditingId(null);
      setActiveTab("mine");
      await fetchMine();
    } catch (error) {
      Alert.alert("提交失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const editRecipe = (recipe: MyRecipe) => {
    if (recipe.status === "approved") {
      Alert.alert("无法修改", "已审核通过的食谱不能直接修改");
      return;
    }
    setForm({
      title: recipe.title || "",
      description: recipe.description || "",
      imageUrl: recipe.image_url || "",
      cookTime: recipe.cook_time ? String(recipe.cook_time) : "",
      prepTime: recipe.prep_time == null ? "" : String(recipe.prep_time),
      difficulty: recipe.difficulty || "简单",
      calories: String(recipe.calories || ""),
      protein: String(recipe.protein || ""),
      carbs: String(recipe.carbs || ""),
      fat: String(recipe.fat || ""),
      nutritionExtras: (recipe.nutrition || [])
        .filter((item) => !["protein", "carbs", "fat"].includes(item.key))
        .map((item) => ({ ...item, value: String(item.value) })),
      category: recipe.category || "家常菜",
      tags: Array.isArray(recipe.tags) ? recipe.tags.join("，") : "",
      ingredients: recipe.ingredients?.length
        ? recipe.ingredients.map((item) => ({ ...item, group: item.group || "主料" }))
        : [{ name: "", amount: "", group: "主料" }],
      steps: recipe.steps?.length ? recipe.steps : [""],
    });
    setEditingId(recipe.id);
    setActiveTab("submit");
  };

  const withdrawRecipe = (recipe: MyRecipe) => {
    Alert.alert("撤回投稿", `确定撤回《${recipe.title}》吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "确认撤回",
        style: "destructive",
        onPress: async () => {
          try {
            await recipesApi.withdraw(authFetch, recipe.id);
            fetchMine();
          } catch (error) {
            Alert.alert("撤回失败", error instanceof Error ? error.message : "请稍后重试");
          }
        },
      },
    ]);
  };

  if (!isAuthenticated) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8">
          <View className="h-16 w-16 items-center justify-center rounded-[24px] bg-brand/10">
            <FontAwesome6 name="utensils" size={26} colorClassName="accent-brand" />
          </View>
          <Text className="mt-5 text-xl font-black text-ink">登录后投稿食谱</Text>
          <Text className="mt-2 text-center text-sm leading-6 text-copy-muted">
            分享你的食材搭配和烹饪步骤，审核通过后会展示在食谱广场。
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/login")}
            className="mt-6 rounded-2xl bg-brand-fill px-8 py-3"
          >
            <Text className="font-bold text-white">前往登录</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="flex-row items-center border-b border-line bg-canvas px-5 py-3">
        <TouchableOpacity
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full bg-surface"
        >
          <FontAwesome6 name="arrow-left" size={15} colorClassName="accent-ink" />
        </TouchableOpacity>
        <View className="ml-3 flex-1">
          <Text className="text-lg font-black text-ink">食谱创作中心</Text>
          <Text className="text-[11px] text-copy-muted">分享好味道，审核后公开展示</Text>
        </View>
      </View>

      <View className="mx-5 my-3 flex-row rounded-2xl bg-background-secondary p-1">
        <TabButton active={activeTab === "submit"} label={editingId ? "修改投稿" : "投稿食谱"} onPress={() => setActiveTab("submit")} />
        <TabButton active={activeTab === "mine"} label={`我的投稿 ${myRecipes.length}`} onPress={() => setActiveTab("mine")} />
      </View>

      {activeTab === "submit" ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 80 }}
        >
          <Section title="封面与基本信息">
            <TouchableOpacity
              onPress={pickImage}
              className="mb-4 h-44 overflow-hidden rounded-[24px] border border-dashed border-warm bg-surface"
            >
              {form.imageUrl ? (
                <Image source={{ uri: form.imageUrl }} className="h-full w-full" resizeMode="cover" />
              ) : (
                <View className="flex-1 items-center justify-center">
                  <FontAwesome6 name="image" size={28} colorClassName="accent-warm" />
                  <Text className="mt-2 text-sm font-bold text-copy-muted">选择食谱封面</Text>
                </View>
              )}
            </TouchableOpacity>
            <Field label="食谱标题" value={form.title} onChangeText={(value) => setForm({ ...form, title: value })} placeholder="例如：番茄鸡胸肉能量碗" />
            <Field label="食谱简介" value={form.description} onChangeText={(value) => setForm({ ...form, description: value })} placeholder="介绍食谱的口味和营养亮点" multiline />
            <Text className="mb-2 text-xs font-bold text-ink">分类</Text>
            <View className="mb-4 flex-row flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <ChoiceChip
                  key={category}
                  active={form.category === category}
                  label={category}
                  onPress={() => setForm({ ...form, category })}
                />
              ))}
            </View>
            <Text className="mb-2 text-xs font-bold text-ink">难度</Text>
            <View className="mb-4 flex-row gap-2">
              {DIFFICULTIES.map((difficulty) => (
                <ChoiceChip
                  key={difficulty}
                  active={form.difficulty === difficulty}
                  label={difficulty}
                  onPress={() => setForm({ ...form, difficulty })}
                />
              ))}
            </View>
            <Field label="烹饪时间（分钟）" value={form.cookTime} onChangeText={(value) => setForm({ ...form, cookTime: value })} keyboardType="numeric" placeholder="未核实可留空" />
            <Field label="准备时间（分钟）" value={form.prepTime} onChangeText={(value) => setForm({ ...form, prepTime: value })} keyboardType="numeric" placeholder="未核实可留空，确实无需准备填 0" />
            <Field label="标签（用逗号分隔）" value={form.tags} onChangeText={(value) => setForm({ ...form, tags: value })} placeholder="低脂，高蛋白，快手" />
          </Section>

          <Section title="每份营养信息">
            <View className="flex-row flex-wrap justify-between">
              {[
                ["热量 kcal", "calories"],
                ["蛋白质 g", "protein"],
                ["碳水 g", "carbs"],
                ["脂肪 g", "fat"],
              ].map(([label, key]) => (
                <View key={key} style={{ width: "48%" }}>
                  <Field
                    label={label}
                    value={form[key as "calories" | "protein" | "carbs" | "fat"]}
                    onChangeText={(value) => setForm({ ...form, [key]: value })}
                    keyboardType="decimal-pad"
                  />
                </View>
              ))}
            </View>
            <View className="mt-1 border-t border-line pt-4">
              <View className="mb-3 flex-row items-center justify-between">
                <View>
                  <Text className="text-xs font-bold text-ink">更多营养数据</Text>
                  <Text className="mt-1 text-[10px] text-copy-muted">例如膳食纤维、糖、钠、胆固醇</Text>
                </View>
                <Text className="text-[10px] text-copy-muted">最多 12 项</Text>
              </View>
              {form.nutritionExtras.map((item, index) => (
                <View key={`${item.key || "new"}-${index}`} className="mb-3 rounded-2xl bg-background-secondary p-3">
                  <View className="flex-row gap-2">
                    <View className="flex-1">
                      <Field
                        label="营养名称"
                        value={item.label}
                        onChangeText={(value) => {
                          const nutritionExtras = [...form.nutritionExtras];
                          nutritionExtras[index] = { ...nutritionExtras[index], label: value };
                          setForm({ ...form, nutritionExtras });
                        }}
                        placeholder="膳食纤维"
                      />
                    </View>
                    <View className="w-24">
                      <Field
                        label="数值"
                        value={item.value}
                        onChangeText={(value) => {
                          const nutritionExtras = [...form.nutritionExtras];
                          nutritionExtras[index] = { ...nutritionExtras[index], value };
                          setForm({ ...form, nutritionExtras });
                        }}
                        placeholder="5.2"
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View className="w-20">
                      <Field
                        label="单位"
                        value={item.unit}
                        onChangeText={(value) => {
                          const nutritionExtras = [...form.nutritionExtras];
                          nutritionExtras[index] = { ...nutritionExtras[index], unit: value };
                          setForm({ ...form, nutritionExtras });
                        }}
                        placeholder="g"
                      />
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => setForm({
                      ...form,
                      nutritionExtras: form.nutritionExtras.filter((_, itemIndex) => itemIndex !== index),
                    })}
                    className="self-end flex-row items-center rounded-lg px-2 py-1"
                  >
                    <FontAwesome6 name="trash" size={10} colorClassName="accent-critical" />
                    <Text className="ml-1.5 text-[10px] font-bold text-critical">删除此项</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {form.nutritionExtras.length < 12 ? (
                <AddButton
                  label="添加营养项"
                  onPress={() => setForm({
                    ...form,
                    nutritionExtras: [...form.nutritionExtras, { label: "", value: "", unit: "g" }],
                  })}
                />
              ) : null}
            </View>
          </Section>

          <Section title="食材清单">
            {form.ingredients.map((item, index) => (
              <View key={index} className="mb-3 rounded-2xl bg-background-secondary p-3">
                <View className="flex-row items-end gap-2">
                  <View className="flex-1">
                    <Field
                      label="食材名称"
                      value={item.name}
                      onChangeText={(value) => {
                        const ingredients = [...form.ingredients];
                        ingredients[index] = { ...ingredients[index], name: value };
                        setForm({ ...form, ingredients });
                      }}
                      placeholder="鸡胸肉"
                    />
                  </View>
                  <View className="w-28">
                    <Field
                      label="用量"
                      value={item.amount}
                      onChangeText={(value) => {
                        const ingredients = [...form.ingredients];
                        ingredients[index] = { ...ingredients[index], amount: value };
                        setForm({ ...form, ingredients });
                      }}
                      placeholder="200g"
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => setForm({ ...form, ingredients: form.ingredients.filter((_, itemIndex) => itemIndex !== index) })}
                    disabled={form.ingredients.length === 1}
                    className="mb-4 h-11 w-11 items-center justify-center rounded-xl bg-danger-soft disabled:opacity-30"
                  >
                    <FontAwesome6 name="minus" size={13} colorClassName="accent-critical" />
                  </TouchableOpacity>
                </View>
                <View className="flex-row gap-2">
                  {INGREDIENT_GROUPS.map((group) => (
                    <ChoiceChip
                      key={group}
                      active={item.group === group}
                      label={group}
                      onPress={() => {
                        const ingredients = [...form.ingredients];
                        ingredients[index] = { ...ingredients[index], group };
                        setForm({ ...form, ingredients });
                      }}
                    />
                  ))}
                </View>
              </View>
            ))}
            <AddButton
              label="添加食材"
              onPress={() => setForm({ ...form, ingredients: [...form.ingredients, { name: "", amount: "", group: "主料" }] })}
            />
          </Section>

          <Section title="烹饪步骤">
            {form.steps.map((step, index) => (
              <View key={index} className="mb-3 flex-row items-start gap-3">
                <View className="mt-1 h-7 w-7 items-center justify-center rounded-full bg-brand-fill">
                  <Text className="text-xs font-black text-white">{index + 1}</Text>
                </View>
                <TextInput
                  value={step}
                  onChangeText={(value) => {
                    const steps = [...form.steps];
                    steps[index] = value;
                    setForm({ ...form, steps });
                  }}
                  placeholder="描述这一步的操作"
                  multiline
                  className="min-h-20 flex-1 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
                />
                <TouchableOpacity
                  onPress={() => setForm({ ...form, steps: form.steps.filter((_, stepIndex) => stepIndex !== index) })}
                  disabled={form.steps.length === 1}
                  className="mt-1 h-9 w-9 items-center justify-center rounded-xl bg-danger-soft disabled:opacity-30"
                >
                  <FontAwesome6 name="minus" size={12} colorClassName="accent-critical" />
                </TouchableOpacity>
              </View>
            ))}
            <AddButton label="添加步骤" onPress={() => setForm({ ...form, steps: [...form.steps, ""] })} />
          </Section>

          <TouchableOpacity
            onPress={submit}
            disabled={submitting}
            className="mt-2 flex-row items-center justify-center rounded-2xl bg-brand-fill py-4 disabled:opacity-50"
          >
            {submitting ? (
              <ActivityIndicator colorClassName="accent-on-brand" />
            ) : (
              <>
                <FontAwesome6 name="paper-plane" size={14} colorClassName="accent-on-brand" />
                <Text className="ml-2 font-black text-white">{editingId ? "重新提交审核" : "提交食谱审核"}</Text>
              </>
            )}
          </TouchableOpacity>
          {editingId ? (
            <TouchableOpacity
              onPress={() => {
                setEditingId(null);
                setForm(emptyForm());
              }}
              className="mt-3 items-center py-3"
            >
              <Text className="text-sm font-bold text-copy-muted">取消修改</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 80 }}
        >
          {loadingMine ? (
            <View className="items-center py-20">
              <ActivityIndicator colorClassName="accent-brand" />
            </View>
          ) : myRecipes.length === 0 ? (
            <View className="items-center rounded-[28px] bg-surface px-8 py-16">
              <FontAwesome6 name="book-open" size={30} colorClassName="accent-warm" />
              <Text className="mt-4 text-base font-black text-ink">还没有投稿</Text>
              <Text className="mt-1 text-center text-xs text-copy-muted">整理你的拿手菜，分享给更多食友</Text>
              <TouchableOpacity onPress={() => setActiveTab("submit")} className="mt-5 rounded-xl bg-brand-fill px-5 py-2.5">
                <Text className="font-bold text-white">开始投稿</Text>
              </TouchableOpacity>
            </View>
          ) : (
            myRecipes.map((recipe) => (
              <View key={recipe.id} className="mb-4 overflow-hidden rounded-[24px] border border-line bg-surface">
                <View className="flex-row">
                  {recipe.image_url ? (
                    <Image source={{ uri: recipe.image_url }} className="h-28 w-28" resizeMode="cover" />
                  ) : (
                    <View className="h-28 w-28 items-center justify-center bg-background-secondary">
                      <FontAwesome6 name="utensils" size={22} colorClassName="accent-warm" />
                    </View>
                  )}
                  <View className="flex-1 p-4">
                    <View className="flex-row items-center justify-between">
                      <StatusBadge status={recipe.status} />
                      <Text className="text-[10px] text-copy-muted">{recipe.category}</Text>
                    </View>
                    <Text className="mt-2 text-base font-black text-ink" numberOfLines={1}>{recipe.title}</Text>
                    <Text className="mt-1 text-[11px] text-copy-muted" numberOfLines={2}>{recipe.description || "暂无简介"}</Text>
                  </View>
                </View>
                {recipe.status === "rejected" ? (
                  <View className="mx-4 rounded-xl bg-danger-soft px-3 py-2">
                    <Text className="text-xs text-critical">驳回原因：{recipe.reject_reason || "请完善内容后重试"}</Text>
                  </View>
                ) : null}
                <View className="flex-row gap-2 p-4">
                  {recipe.status === "approved" ? (
                    <TouchableOpacity
                      onPress={() => router.push("/recipe-detail", { id: recipe.id })}
                      className="flex-1 items-center rounded-xl bg-brand/10 py-2.5"
                    >
                      <Text className="text-xs font-black text-brand">查看公开页面</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => editRecipe(recipe)}
                      className="flex-1 flex-row items-center justify-center rounded-xl bg-brand/10 py-2.5"
                    >
                      <FontAwesome6 name="pen" size={11} colorClassName="accent-brand" />
                      <Text className="ml-1.5 text-xs font-black text-brand">修改投稿</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => withdrawRecipe(recipe)}
                    className="flex-row items-center justify-center rounded-xl bg-danger-soft px-4 py-2.5"
                  >
                    <FontAwesome6 name="trash" size={11} colorClassName="accent-critical" />
                    <Text className="ml-1.5 text-xs font-bold text-critical">撤回</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} className={`flex-1 items-center rounded-xl py-2.5 ${active ? "bg-surface" : ""}`}>
      <Text className={`text-sm font-black ${active ? "text-brand" : "text-copy-muted"}`}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-4 rounded-[24px] border border-line bg-surface p-4">
      <Text className="mb-4 text-base font-black text-ink">{title}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric" | "decimal-pad";
}) {
  return (
    <View className="mb-4">
      {label ? <Text className="mb-2 text-xs font-bold text-ink">{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        keyboardType={keyboardType}
        className={`rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-ink ${multiline ? "min-h-24" : ""}`}
      />
    </View>
  );
}

function ChoiceChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`rounded-full border px-3.5 py-2 ${active ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}
    >
      <Text className={`text-xs font-bold ${active ? "text-white" : "text-copy-muted"}`}>{label}</Text>
    </TouchableOpacity>
  );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} className="flex-row items-center justify-center rounded-xl border border-dashed border-brand/40 py-3">
      <FontAwesome6 name="plus" size={12} colorClassName="accent-brand" />
      <Text className="ml-2 text-xs font-black text-brand">{label}</Text>
    </TouchableOpacity>
  );
}

function StatusBadge({ status }: { status: RecipeStatus }) {
  const config = {
    pending: { label: "待审核", classes: "bg-warm-soft text-warm" },
    approved: { label: "已通过", classes: "bg-success-soft text-success" },
    rejected: { label: "已驳回", classes: "bg-danger-soft text-critical" },
  }[status];
  return (
    <View className={`rounded-full px-2.5 py-1 ${config.classes.split(" ")[0]}`}>
      <Text className={`text-[10px] font-black ${config.classes.split(" ")[1]}`}>{config.label}</Text>
    </View>
  );
}
