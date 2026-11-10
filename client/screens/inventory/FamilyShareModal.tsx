import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useAuthFetch } from "@/contexts/AuthContext";
import { householdApi, type Household } from "@/services/api";

interface FamilyShareModalProps {
  visible: boolean;
  activeHousehold: Household | null;
  households: Household[];
  onClose: () => void;
  onSelectHousehold: (household: Household | null) => void;
  onRefreshHouseholds: () => void;
}

export function FamilyShareModal({
  visible,
  activeHousehold,
  households,
  onClose,
  onSelectHousehold,
  onRefreshHouseholds,
}: FamilyShareModalProps) {
  const authFetch = useAuthFetch();
  const [tab, setTab] = useState<"manage" | "create" | "join">("manage");
  const [createName, setCreateName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!createName.trim()) {
      Alert.alert("提示", "请输入家庭空间名称");
      return;
    }
    setLoading(true);
    try {
      const created = await householdApi.create(authFetch, createName.trim());
      Alert.alert("创建成功", `家庭【${created.name}】已成功创建！邀请码为 ${created.invite_code}`);
      setCreateName("");
      onRefreshHouseholds();
      onSelectHousehold(created);
      setTab("manage");
    } catch (e: any) {
      Alert.alert("创建失败", e?.message || "请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) {
      Alert.alert("提示", "请输入 8 位家庭邀请码");
      return;
    }
    setLoading(true);
    try {
      const res = await householdApi.join(authFetch, joinCode.trim().toUpperCase());
      Alert.alert("加入成功", res.message || `已加入家庭【${res.household.name}】！`);
      setJoinCode("");
      onRefreshHouseholds();
      onSelectHousehold(res.household);
      setTab("manage");
    } catch (e: any) {
      Alert.alert("加入失败", e?.message || "请检查邀请码是否正确");
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = (h: Household) => {
    Alert.alert("退出家庭", `确定要退出家庭空间【${h.name}】吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "确认退出",
        style: "destructive",
        onPress: async () => {
          try {
            await householdApi.leave(authFetch, h.id);
            if (activeHousehold?.id === h.id) {
              onSelectHousehold(null);
            }
            onRefreshHouseholds();
          } catch (e: any) {
            Alert.alert("退出失败", e?.message || "请重试");
          }
        },
      },
    ]);
  };

  const handleTransferOwner = (household: Household, userId: number, name: string) => {
    Alert.alert("转移家庭所有者", `确认将【${household.name}】转交给 @${name} 吗？未完成采购项和库存会继续保留。`, [
      { text: "取消", style: "cancel" },
      {
        text: "确认转移",
        onPress: () => {
          void householdApi.transferOwner(authFetch, household.id, userId, household.version)
            .then(() => {
              onRefreshHouseholds();
              Alert.alert("已完成转移", "家庭数据与未完成采购项均已保留。");
            })
            .catch((error) => Alert.alert("转移失败", error instanceof Error ? error.message : "请刷新后重试"));
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[85%] rounded-t-[32px] bg-surface px-5 pt-5 pb-6">
          <View className="flex-row items-center justify-between border-b border-line pb-3">
            <View className="flex-row items-center gap-2">
              <FontAwesome6 name="house-user" size={18} colorClassName="accent-brand" />
              <Text className="text-lg font-black text-ink">家庭共享空间</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-full bg-canvas">
              <FontAwesome6 name="xmark" size={16} colorClassName="accent-copy-muted" />
            </TouchableOpacity>
          </View>

          {/* Sub Navigation */}
          <View className="flex-row items-center gap-2 my-3">
            <TouchableOpacity
              onPress={() => setTab("manage")}
              className={`px-3.5 py-1.5 rounded-full border ${
                tab === "manage" ? "bg-brand-fill border-brand" : "bg-canvas border-line"
              }`}
            >
              <Text className={`text-xs font-bold ${tab === "manage" ? "text-white" : "text-copy-muted"}`}>
                我的家庭 ({households.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setTab("create")}
              className={`px-3.5 py-1.5 rounded-full border ${
                tab === "create" ? "bg-brand-fill border-brand" : "bg-canvas border-line"
              }`}
            >
              <Text className={`text-xs font-bold ${tab === "create" ? "text-white" : "text-copy-muted"}`}>
                + 创建家庭
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setTab("join")}
              className={`px-3.5 py-1.5 rounded-full border ${
                tab === "join" ? "bg-brand-fill border-brand" : "bg-canvas border-line"
              }`}
            >
              <Text className={`text-xs font-bold ${tab === "join" ? "text-white" : "text-copy-muted"}`}>
                输入邀请码
              </Text>
            </TouchableOpacity>
          </View>

          {tab === "manage" && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-3 pb-4">
              {/* 个人独享空间选项 */}
              <TouchableOpacity
                onPress={() => {
                  onSelectHousehold(null);
                  onClose();
                }}
                className={`p-4 rounded-2xl border flex-row items-center justify-between ${
                  !activeHousehold ? "border-brand bg-brand-soft" : "border-line bg-canvas"
                }`}
              >
                <View className="flex-row items-center gap-3">
                  <View className="w-10 h-10 rounded-2xl bg-brand/10 items-center justify-center">
                    <FontAwesome6 name="user" size={16} colorClassName="accent-brand" />
                  </View>
                  <View>
                    <Text className="text-sm font-black text-ink">个人私享食材库</Text>
                    <Text className="text-[11px] text-copy-muted mt-0.5">仅自己可见，独立存放管理</Text>
                  </View>
                </View>
                {!activeHousehold && (
                  <View className="bg-brand-fill px-2.5 py-1 rounded-full">
                    <Text className="text-[10px] font-black text-white">当前使用</Text>
                  </View>
                )}
              </TouchableOpacity>

              {households.length > 0 && (
                <Text className="text-xs font-bold text-copy-muted mt-1">已加入的家庭空间</Text>
              )}

              {households.map((h) => {
                const isCurrent = activeHousehold?.id === h.id;
                return (
                  <View
                    key={h.id}
                    className={`p-4 rounded-2xl border ${
                      isCurrent ? "border-brand bg-success-soft/50" : "border-line bg-canvas"
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                        <View className="w-10 h-10 rounded-2xl bg-warm-soft items-center justify-center">
                          <FontAwesome6 name="house" size={16} colorClassName="accent-warm" />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-black text-ink">{h.name}</Text>
                          <Text className="text-[11px] text-copy-muted mt-0.5">
                            邀请码: <Text className="font-mono font-bold text-warm">{h.invite_code}</Text> · {h.members?.length || 1} 成员
                          </Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={() => {
                          onSelectHousehold(h);
                          onClose();
                        }}
                        className={`px-3 py-1.5 rounded-full border ${
                          isCurrent ? "bg-brand-fill border-brand" : "bg-surface border-line"
                        }`}
                      >
                        <Text className={`text-xs font-bold ${isCurrent ? "text-white" : "text-ink"}`}>
                          {isCurrent ? "使用中" : "切换进入"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Member Avatars Tag Cloud */}
                    <View className="mt-3 flex-row items-center gap-1.5 flex-wrap border-t border-line/60 pt-2.5">
                      <Text className="text-[10px] text-copy-muted mr-1">家庭成员:</Text>
                      {h.members?.map((m) => (
                        <TouchableOpacity
                          key={m.user_id}
                          disabled={h.my_role !== "owner" || m.role === "owner"}
                          onPress={() => handleTransferOwner(h, m.user_id, m.nickname || m.username)}
                          className="bg-surface border border-line px-2 py-0.5 rounded-full flex-row items-center gap-1"
                        >
                          <Text className="text-[10px] font-bold text-ink">@{m.nickname || m.username}</Text>
                          {m.role === "owner" && <Text className="text-[8px] font-black text-warm">房主</Text>}
                          {h.my_role === "owner" && m.role !== "owner" && <Text className="text-[8px] font-black text-brand">可转交</Text>}
                        </TouchableOpacity>
                      ))}

                      <TouchableOpacity onPress={() => handleLeave(h)} className="ml-auto px-2 py-0.5">
                        <Text className="text-[10px] text-critical font-bold">退出家庭</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {tab === "create" && (
            <View className="py-4 gap-4">
              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1.5">家庭空间名称</Text>
                <TextInput
                  value={createName}
                  onChangeText={setCreateName}
                  placeholder="如: 幸福温馨家 / 美味小窝"
                  placeholderTextColorClassName="accent-copy-muted"
                  className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink font-medium"
                />
              </View>

              <TouchableOpacity
                onPress={handleCreate}
                disabled={loading}
                className="bg-brand-fill py-3.5 rounded-2xl items-center shadow-xs active:opacity-90 disabled:opacity-50"
              >
                {loading ? <ActivityIndicator colorClassName="accent-on-brand" /> : <Text className="text-sm font-black text-white">立即创建家庭空间</Text>}
              </TouchableOpacity>
            </View>
          )}

          {tab === "join" && (
            <View className="py-4 gap-4">
              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1.5">8 位家庭邀请码</Text>
                <TextInput
                  value={joinCode}
                  onChangeText={setJoinCode}
                  autoCapitalize="characters"
                  placeholder="如: HOME8888"
                  placeholderTextColorClassName="accent-copy-muted"
                  className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink font-mono font-bold tracking-widest text-center"
                />
              </View>

              <TouchableOpacity
                onPress={handleJoin}
                disabled={loading}
                className="bg-brand-fill py-3.5 rounded-2xl items-center shadow-xs active:opacity-90 disabled:opacity-50"
              >
                {loading ? <ActivityIndicator colorClassName="accent-on-brand" /> : <Text className="text-sm font-black text-white">加入家庭空间</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
