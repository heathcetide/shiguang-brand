import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Screen } from "@/components/Screen";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuthFetch } from "@/contexts/AuthContext";
import { foodsApi } from "@/services/api";


export default function CustomFoodScreen() {
  const router = useSafeRouter();
  const authFetch = useAuthFetch();
  
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert("提示", "请输入食材名称");
      return;
    }
    if (!calories.trim()) {
      Alert.alert("提示", "请输入每100g的热量");
      return;
    }

    setLoading(true);
    try {
      await foodsApi.submitCustom(authFetch, {
          name: name.trim(),
          calories_100g: Number(calories),
          protein_100g: protein ? Number(protein) : 0,
          carbs_100g: carbs ? Number(carbs) : 0,
          fat_100g: fat ? Number(fat) : 0,
      });
      Alert.alert("提交成功", "感谢您的贡献！数据已提交，等待管理员审核后全网共享～", [
        { text: "好的", onPress: () => router.back() }
      ]);
    } catch (error) {
      Alert.alert("网络错误", "请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen safeAreaEdges={["top", "bottom"]}>
      <View className="px-5 pt-2 pb-4 flex-row items-center justify-between border-b border-line bg-surface">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <FontAwesome6 name="arrow-left" size={20} colorClassName="accent-ink" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-ink">添加新食材</Text>
        <View className="w-9" />
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 20 }}>
          <View className="bg-surface p-6 rounded-3xl border border-line shadow-sm">
            <View className="w-16 h-16 bg-brand/10 rounded-full items-center justify-center mb-6 self-center">
              <FontAwesome6 name="camera" size={24} colorClassName="accent-brand" />
            </View>

            <View className="space-y-4">
              <View>
                <Text className="text-sm font-bold text-ink mb-2">食材名称 <Text className="text-critical">*</Text></Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="例如：脱脂牛奶、全麦面包"
                  className="bg-background-secondary px-4 py-3.5 rounded-2xl text-sm text-ink"
                />
              </View>

              <View>
                <Text className="text-sm font-bold text-ink mb-2">卡路里 (kcal/100g) <Text className="text-critical">*</Text></Text>
                <TextInput
                  value={calories}
                  onChangeText={setCalories}
                  placeholder="例如：120"
                  keyboardType="numeric"
                  className="bg-background-secondary px-4 py-3.5 rounded-2xl text-sm text-ink"
                />
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-sm font-bold text-ink mb-2">碳水 (g)</Text>
                  <TextInput
                    value={carbs}
                    onChangeText={setCarbs}
                    placeholder="选填"
                    keyboardType="numeric"
                    className="bg-background-secondary px-4 py-3.5 rounded-2xl text-sm text-ink"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-ink mb-2">蛋白质 (g)</Text>
                  <TextInput
                    value={protein}
                    onChangeText={setProtein}
                    placeholder="选填"
                    keyboardType="numeric"
                    className="bg-background-secondary px-4 py-3.5 rounded-2xl text-sm text-ink"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-ink mb-2">脂肪 (g)</Text>
                  <TextInput
                    value={fat}
                    onChangeText={setFat}
                    placeholder="选填"
                    keyboardType="numeric"
                    className="bg-background-secondary px-4 py-3.5 rounded-2xl text-sm text-ink"
                  />
                </View>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading}
              className={`mt-8 py-4 rounded-2xl items-center ${loading ? 'bg-brand/50' : 'bg-brand-fill active:bg-brand/90'}`}
            >
              <Text className="text-white font-bold text-base">
                {loading ? '提交中...' : '提交审核'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
