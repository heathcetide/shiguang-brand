import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { householdMealProductionSchema, type HouseholdMealProductionInput } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { householdApi, type HouseholdInventoryItem } from "@/services/api/households";
import { ApiError } from "@/services/api/client";
import { getPrivateStorageGeneration, getUserStorageKey, removeUserPrivateStorage, writeUserPrivateStorage } from "@/utils/userStorage";
import { actualQuantity } from "@/screens/household-production/input";

export default function HouseholdProductionScreen() {
  const { user } = useAuth(); const params = useSafeSearchParams<{ householdId?: number; planItem?: HouseholdMealProductionInput["planItem"] }>();
  const householdId = Number(params.householdId); const generation = user?.id ? getPrivateStorageGeneration(user.id) : 0;
  return <ProductionAccount key={`${user?.id ?? 0}-${householdId}-${generation}-${JSON.stringify(params.planItem)}`} userId={user?.id} householdId={householdId} generation={generation} planItem={params.planItem} />;
}
function ProductionAccount({ userId,householdId,generation,planItem }: { userId?: number; householdId: number; generation: number; planItem?: HouseholdMealProductionInput["planItem"] }) {
  const authFetch = useAuthFetch(); const router = useSafeRouter();
  const [inventory,setInventory] = useState<HouseholdInventoryItem[]>([]); const [membershipId,setMembershipId] = useState<number | null>(null);
  const [foodName,setFoodName] = useState(""); const [servings,setServings] = useState(""); const [selected,setSelected] = useState<Record<number,string>>({});
  const [pending,setPending] = useState<HouseholdMealProductionInput | null>(null); const [damaged,setDamaged] = useState(false);
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(""); const [done,setDone] = useState(false);
  const alive = useRef(true); const writing = useRef(false); const sequence = useRef(0);
  const baseKey = `household-production-pending:${householdId}`; const key = getUserStorageKey(baseKey,userId);
  const current = () => alive.current && Boolean(userId) && getPrivateStorageGeneration(userId!) === generation;
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; },[]);
  const load = useCallback(async () => {
    if (!userId || !key || !Number.isSafeInteger(householdId) || householdId < 1 || writing.current) return;
    const ticket = ++sequence.current; setBusy(true); setMembershipId(null); setSelected({}); setMessage("");
    try {
      const stored = await AsyncStorage.getItem(key);
      if (!alive.current || getPrivateStorageGeneration(userId) !== generation || ticket !== sequence.current) return;
      setPending(null); setDamaged(false);
      if (stored) {
        try { setPending(householdMealProductionSchema.parse(JSON.parse(stored))); }
        catch { setDamaged(true); throw new Error("待确认制作无法读取，请先核对家庭批次与库存。"); }
      }
      const [items,member] = await Promise.all([householdApi.inventoryList(authFetch,householdId),householdApi.diningPreferences(authFetch,householdId)]);
      if (!alive.current || getPrivateStorageGeneration(userId) !== generation || ticket !== sequence.current) return;
      setInventory(items.filter(item => item.is_available)); setMembershipId(member.membershipId);
    } catch (error) { if (alive.current && getPrivateStorageGeneration(userId) === generation && ticket === sequence.current) { setInventory([]); setMessage(error instanceof Error ? error.message : "读取失败，请重试"); } }
    finally { if (alive.current && getPrivateStorageGeneration(userId) === generation && ticket === sequence.current) setBusy(false); }
  },[userId,householdId,key,authFetch,generation]);
  useFocusEffect(useCallback(() => { void load(); },[load]));
  const submit = async (retry?: HouseholdMealProductionInput) => {
    if (!userId || busy || writing.current || (!retry && (!membershipId || pending || damaged || done))) return;
    let input: HouseholdMealProductionInput;
    try {
      input = retry ?? householdMealProductionSchema.parse({ ...(planItem ? { planItem } : {}),idempotencyKey: Crypto.randomUUID(),membershipId,foodName,producedServings: Number(servings),inventory: inventory.filter(item => selected[item.id] !== undefined).map(item => {
        const quantity = actualQuantity(selected[item.id]);
        if (!quantity) throw new Error("请逐项填写明确扣量，例如100g、2个。不能填写范围或适量。");
        return { itemId: item.id,version: item.version,amount: quantity.amount,unit: quantity.unit };
      }) });
    } catch { setMessage("请填写制作名称、正数总份量，并选择原料及明确扣量，例如100g、2个。不能填写范围或适量。"); return; }
    writing.current = true; setBusy(true); setMessage(""); sequence.current++;
    let sent = false;
    try {
      if (!await writeUserPrivateStorage(baseKey,userId,generation,JSON.stringify(input)) || !current()) return;
      setPending(input); sent = true;
      await householdApi.produceMeal(authFetch,householdId,input);
      if (!current() || !await removeUserPrivateStorage(baseKey,userId,generation)) return;
      setPending(null); setDone(true); setSelected({}); setMessage("制作已记录，原料已扣减。尚未记录任何人的食用。");
    } catch (error) {
      if (!current()) return;
      const rejected = error instanceof ApiError && ["INVENTORY_VERSION_CONFLICT","INVENTORY_INSUFFICIENT","INVENTORY_UNIT_MISMATCH","STRUCTURED_QUANTITY_REQUIRED","QUANTITY_PRECISION_REQUIRED","INVENTORY_CONFLICT","PLAN_ITEM_UNAVAILABLE","PLAN_ITEM_CHANGED","DINING_HOUSEHOLD_CHANGED","DINING_NOT_MEMBER","DINING_MEMBERS_CHANGED","DINING_RECIPE_UNAVAILABLE","DINING_CONSTRAINT_CONFLICT"].includes(error.code ?? "");
      if (rejected) {
        try {
          if (await removeUserPrivateStorage(baseKey,userId,generation) && current()) { setPending(null); setMembershipId(null); setSelected({}); setInventory([]); }
        } catch { if (current()) setMessage("本次未完成制作，但本地待确认项未能清除。请重试原制作以确认结果。"); return; }
      }
      setMessage(!sent ? "本地待确认项未能保存，本次没有提交，请重试。" : rejected ? `本次没有扣库或创建批次。${error instanceof Error ? error.message : "请刷新后核对"}` : "提交结果尚未确认，请重试原提交，不要再录入同一次制作。");
    } finally { if (current()) { writing.current = false; setBusy(false); } }
  };
  const clear = async () => {
    if (!userId || busy || writing.current) return;
    writing.current = true; setBusy(true);
    try {
      if (await removeUserPrivateStorage(baseKey,userId,generation) && current()) { setPending(null); setDamaged(false); setMembershipId(null); setMessage("待确认项已清除；不会撤销原料扣减或删除批次。请刷新后继续。"); }
    } catch { if (current()) setMessage("清除失败，请重试。"); }
    finally { if (current()) { writing.current = false; setBusy(false); } }
  };
  return <Screen className="flex-1 bg-background">
    <View className="flex-row gap-6 p-5"><TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-bold text-ink">记录家庭制作</Text></View>
    <ScrollView contentContainerClassName="p-5 gap-4">
      <Text className="text-copy-muted">仅记录已经完成的制作。选择实际用掉的家庭原料，扣减一次并生成全额待吃量；每人食用后再分别记录。当前不混用个人库存。</Text>
      {planItem ? <Text className="text-copy-muted">这次制作将关联所选个人餐次，成功后把该餐标记为制作完成。不会直接生成个人摄入；已经排队或进入制作的餐次须保留原执行流程。</Text> : null}
      {!userId ? <Text className="text-ink">请登录后记录。</Text> : !Number.isSafeInteger(householdId) || householdId < 1 ? <Text className="text-ink">请从家庭待吃页进入。</Text> : <>
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void load()}><Text className="text-brand">刷新家庭库存</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => router.push({ pathname: "/household-meals",params: { householdId } })}><Text className="text-brand">查看家庭待吃批次</Text></TouchableOpacity>
        {message ? <Text accessibilityLiveRegion="polite" className="text-ink">{message}</Text> : null}
        {pending || damaged ? <View className="gap-3 rounded-xl bg-surface p-4">
          <Text className="text-ink">有一笔制作待确认。先重试原提交；若无法确认，请先核对家庭批次和库存再清除待确认项。</Text>
          {pending ? <><Text className="text-ink">{pending.foodName} · {pending.producedServings} 份</Text>{pending.planItem ? <Text className="text-copy-muted">原提交关联个人餐次，重试保持原关联。</Text> : null}<TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void submit(pending)}><Text className="font-bold text-brand">重试原制作</Text></TouchableOpacity></> : null}
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void clear()}><Text className="text-copy-muted">已核对批次和库存，清除待确认项</Text></TouchableOpacity>
        </View> : done ? <Text className="text-ink">请到家庭待吃页查看新批次。</Text> : membershipId ? <>
          <Text className="text-ink">制作名称</Text><TextInput accessibilityLabel="家庭制作名称" value={foodName} onChangeText={setFoodName} editable={!busy} className="rounded-xl border border-border p-3 text-ink" />
          <Text className="text-ink">总制作份量（不是个人摄入）</Text><TextInput accessibilityLabel="总制作份量" value={servings} onChangeText={setServings} keyboardType="decimal-pad" editable={!busy} className="rounded-xl border border-border p-3 text-ink" />
          {!inventory.length ? <Text className="text-copy-muted">暂无可用家庭库存，请先到库存页添加或核对。</Text> : inventory.map(item => <View key={item.id} className="gap-2 rounded-xl bg-surface p-4">
            <View className="flex-row items-center justify-between"><Text className="font-bold text-ink">{item.food_name} · 当前 {item.quantity}</Text><Switch accessibilityLabel={`使用${item.food_name}`} disabled={busy} value={selected[item.id] !== undefined} onValueChange={value => setSelected(previous => { const next = { ...previous }; if (value) next[item.id] = ""; else delete next[item.id]; return next; })} /></View>
            {selected[item.id] !== undefined ? <TextInput accessibilityLabel={`${item.food_name}实际扣量`} placeholder="例如100g、2个" value={selected[item.id]} editable={!busy} onChangeText={value => setSelected(previous => ({ ...previous,[item.id]: value }))} className="rounded-xl border border-border p-3 text-ink" /> : null}
          </View>)}
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void submit()} className="rounded-xl bg-brand p-4"><Text className="text-center font-bold text-white">确认完成制作并扣减所选原料</Text></TouchableOpacity>
        </> : null}
      </>}
    </ScrollView>
  </Screen>;
}
