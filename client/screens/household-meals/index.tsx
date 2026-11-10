import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { householdMealReservationSchema, householdMealEatingSchema, type HouseholdMeal, type HouseholdMealEatingInput } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { householdApi } from "@/services/api/households";
import { ApiError } from "@/services/api/client";
import { getPrivateStorageGeneration, getUserStorageKey, removeUserPrivateStorage, writeUserPrivateStorage } from "@/utils/userStorage";
import { toLocalDateKey } from "@/utils/date";

type Pending = { mealId: string; input: HouseholdMealEatingInput };
export default function HouseholdMealsScreen() {
  const { user } = useAuth(); const params = useSafeSearchParams<{ householdId?: number }>();
  const householdId = Number(params.householdId);
  return <MealsAccount key={`${user?.id ?? 0}-${householdId}-${user?.id ? getPrivateStorageGeneration(user.id) : 0}`} userId={user?.id} householdId={householdId} />;
}
function MealsAccount({ userId,householdId }: { userId?: number; householdId: number }) {
  const authFetch = useAuthFetch(); const router = useSafeRouter();
  const [meals,setMeals] = useState<HouseholdMeal[]>([]); const [membershipId,setMembershipId] = useState<number | null>(null);
  const [reservation,setReservation] = useState<HouseholdMeal | null>(null); const [reservationAmount,setReservationAmount] = useState("1");
  const [selection,setSelection] = useState<HouseholdMeal | null>(null); const [servings,setServings] = useState("1");
  const [date,setDate] = useState(toLocalDateKey()); const [time,setTime] = useState("");
  const [mealType,setMealType] = useState<HouseholdMealEatingInput["mealType"]>("lunch");
  const [pendingProblem,setPendingProblem] = useState(false);
  const [pending,setPending] = useState<Pending | null>(null); const [busy,setBusy] = useState(false); const [message,setMessage] = useState("");
  const alive = useRef(true); const sequence = useRef(0); const writing = useRef(false);
  const generation = userId ? getPrivateStorageGeneration(userId) : 0;
  const baseKey = `household-eating-pending:${householdId}`; const key = getUserStorageKey(baseKey,userId);
  const current = () => alive.current && Boolean(userId) && getPrivateStorageGeneration(userId!) === generation;
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; },[]);
  const load = useCallback(async () => {
    if (!userId || !Number.isSafeInteger(householdId) || householdId < 1 || !key || writing.current) return;
    const ticket = ++sequence.current; setBusy(true); setSelection(null); setReservation(null); setMessage("");
    try {
      const stored = await AsyncStorage.getItem(key);
      if (!alive.current || getPrivateStorageGeneration(userId) !== generation || ticket !== sequence.current) return;
      setPendingProblem(false);
      if (stored) {
        try {
          const raw = JSON.parse(stored) as Pending;
          if (typeof raw.mealId !== "string") throw new Error("Invalid meal id");
          setPending({ mealId: raw.mealId,input: householdMealEatingSchema.parse(raw.input) });
        } catch { setPendingProblem(true); throw new Error("待确认记录无法读取，请先核对个人摄入再清除待确认项。"); }
      } else setPending(null);
      const [list,member] = await Promise.all([householdApi.meals(authFetch,householdId),householdApi.diningPreferences(authFetch,householdId)]);
      if (!alive.current || getPrivateStorageGeneration(userId) !== generation || ticket !== sequence.current) return;
      setMeals(list); setMembershipId(member.membershipId);
    } catch (error) {
      if (alive.current && getPrivateStorageGeneration(userId) === generation && ticket === sequence.current) { setMembershipId(null); setMeals([]); setMessage(error instanceof Error ? error.message : "读取失败，请重试"); }
    } finally { if (alive.current && getPrivateStorageGeneration(userId) === generation && ticket === sequence.current) setBusy(false); }
  },[userId,householdId,key,authFetch,generation]);
  useFocusEffect(useCallback(() => { void load(); },[load]));
  const submit = async (retry?: Pending) => {
    if (!userId || writing.current || busy || (!retry && (!selection || !membershipId || pending))) return;
    let request: Pending;
    try { request = retry ?? { mealId: selection!.id,input: householdMealEatingSchema.parse({ idempotencyKey: Crypto.randomUUID(),membershipId,version: selection!.version,servings: Number(servings),recordedDate: date,recordedTime: time.trim() || null,mealType }) }; }
    catch { setMessage("请核对正数份量、日期和24小时制时间，份量最多六位小数。"); return; }
    let refresh = false; let sent = false;
    writing.current = true; setBusy(true); setMessage(""); sequence.current++;
    try {
      if (!await writeUserPrivateStorage(baseKey,userId,generation,JSON.stringify(request)) || !current()) return;
      setPending(request);
      sent = true;
      await householdApi.eatMeal(authFetch,householdId,request.mealId,request.input);
      if (!current()) return;
      if (!await removeUserPrivateStorage(baseKey,userId,generation)) return;
      setPending(null); setSelection(null); setMeals([]); setMessage("本人食用已记录，正在刷新余量。"); refresh = true;
    } catch (error) {
      if (!current()) return;
      const rejected = error instanceof ApiError && ["MEAL_VERSION_CONFLICT","MEAL_INSUFFICIENT","MEAL_RESERVED"].includes(error.code ?? "");
      if (rejected) {
        try {
          if (await removeUserPrivateStorage(baseKey,userId,generation) && current()) { setPending(null); setSelection(null); setMembershipId(null); setMeals([]); }
        } catch { if (current()) setMessage("本次未记录食用，但本地待确认项未能清除。请重试原提交以确认结果。"); return; }
      }
      setMessage(!sent ? "未能保存待确认项，本次尚未提交。请重试。" : rejected ? "余量已变化，本次未记录。请刷新后重新填写。" : "提交结果尚未确认，请重试原提交。不要重新记录同一次食用。");
    } finally { if (current()) { writing.current = false; setBusy(false); if (refresh) void load(); } }
  };
  const saveReservation = async () => {
    if (!userId || !reservation || !membershipId || pending || busy || writing.current) return;
    const input = householdMealReservationSchema.safeParse({ membershipId,version: reservation.version,servings: Number(reservationAmount) });
    if (!input.success || !reservationAmount.trim()) { setMessage("请输入0到30份，最多六位小数；0表示取消自己的预留。"); return; }
    writing.current = true; setBusy(true); sequence.current++; let refresh = false;
    try {
      await householdApi.reserveMeal(authFetch,householdId,reservation.id,input.data);
      if (current()) { setReservation(null); refresh = true; }
    } catch {
      if (current()) { setReservation(null); setMeals([]); setMembershipId(null); setMessage("预留结果尚未确认，或份量已变化。请刷新核对后再修改。"); }
    } finally { if (current()) { writing.current = false; setBusy(false); if (refresh) void load(); } }
  };
  const clear = async () => {
    if (!userId || busy || writing.current) return;
    writing.current = true; setBusy(true);
    try {
      if (await removeUserPrivateStorage(baseKey,userId,generation) && current()) { setPending(null); setPendingProblem(false); setSelection(null); setMessage("待确认项已清除；不会删除已保存的摄入。请刷新后继续。"); setMembershipId(null); }
    } catch { if (current()) setMessage("未能清除本地待确认项，请重试。"); }
    finally { if (current()) { writing.current = false; setBusy(false); } }
  };
  return <Screen className="flex-1 bg-background">
    <View className="flex-row gap-6 p-5"><TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-bold text-ink">家庭待吃</Text></View>
    <ScrollView contentContainerClassName="p-5 gap-4">
      <Text className="text-copy-muted">最近100个制作批次。只记录你实际吃掉的份量，不替其他成员填写；食用时不会再次扣原料。</Text>
      {!userId ? <Text className="text-ink">请登录后查看。</Text> : !Number.isSafeInteger(householdId) || householdId < 1 ? <Text className="text-ink">请从共餐设置选择家庭后进入。</Text> : <>
        <TouchableOpacity accessibilityRole="button" disabled={busy || Boolean(pending) || pendingProblem} onPress={() => router.push({ pathname: "/household-production",params: { householdId } })}><Text className="font-bold text-brand">记录已完成的家庭制作</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void load()}><Text className="text-brand">{busy ? "处理中…" : "刷新家庭待吃"}</Text></TouchableOpacity>
        {message ? <Text accessibilityLiveRegion="polite" className="text-ink">{message}</Text> : null}
        {pending || pendingProblem ? <View className="gap-3 rounded-xl bg-surface p-4">
          <Text className="text-ink">有一笔食用尚待确认，先重试原提交。</Text>
          {pending ? <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void submit(pending)}><Text className="font-bold text-brand">重试原提交</Text></TouchableOpacity> : null}
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/diet-record")}><Text className="text-brand">查看我的摄入记录</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void clear()}><Text className="text-copy-muted">已核对摄入记录，清除待确认项</Text></TouchableOpacity>
        </View> : null}
        {!busy && membershipId && meals.length === 0 ? <Text className="text-copy-muted">暂无家庭制作批次。</Text> : null}
        {meals.map(meal => <View key={meal.id} className="gap-2 rounded-xl bg-surface p-4">
          <Text className="font-bold text-ink">{meal.foodName}</Text><Text className="text-copy-muted">剩余 {meal.remainingServings} / 制作 {meal.producedServings} 份</Text>
          {meal.availableServings !== undefined ? <Text className="text-copy-muted">我可取用 {meal.availableServings} 份，其中为我预留 {meal.myReservedServings ?? 0} 份</Text> : null}
          <TouchableOpacity accessibilityRole="button" disabled={busy || Boolean(pending) || !membershipId || (meal.availableServings ?? meal.remainingServings) <= 0} onPress={() => { setReservation(null); setSelection(meal); setServings("1"); setDate(toLocalDateKey()); setTime(""); }}><Text className="text-brand">我吃了</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy || Boolean(pending) || !membershipId} onPress={() => { setSelection(null); setReservation(meal); setReservationAmount(String(meal.myReservedServings || 1)); }}><Text className="text-brand">设置我的预留</Text></TouchableOpacity>
        </View>)}
        {reservation && !pending ? <View className="gap-3 rounded-xl bg-surface p-4">
          <Text className="font-bold text-ink">为我预留：{reservation.foodName}</Text>
          <Text className="text-copy-muted">预留不会记录食用；本人食用时优先使用。填0取消自己的预留，退出家庭也会释放。</Text>
          <TextInput accessibilityLabel="我的预留份量" keyboardType="decimal-pad" value={reservationAmount} onChangeText={setReservationAmount} editable={!busy} className="border border-border p-3 text-ink" />
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void saveReservation()}><Text className="font-bold text-brand">保存我的预留</Text></TouchableOpacity>
        </View> : null}
        {selection && !pending ? <View className="gap-3 rounded-xl bg-surface p-4">
          <Text className="font-bold text-ink">记录本人食用：{selection.foodName}</Text>
          <TextInput accessibilityLabel="实际食用份量" value={servings} onChangeText={setServings} keyboardType="decimal-pad" editable={!busy} className="border border-border p-3 text-ink" />
          <TextInput accessibilityLabel="食用日期" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" editable={!busy} className="border border-border p-3 text-ink" />
          <TextInput accessibilityLabel="食用时间" value={time} onChangeText={setTime} placeholder="HH:mm，可留空" editable={!busy} className="border border-border p-3 text-ink" />
          <View className="flex-row gap-4">{(["breakfast","lunch","dinner","snack"] as const).map((type,index) => <TouchableOpacity key={type} accessibilityRole="button" accessibilityState={{ selected: mealType === type }} disabled={busy} onPress={() => setMealType(type)}><Text className={mealType === type ? "font-bold text-brand" : "text-ink"}>{["早餐","午餐","晚餐","加餐"][index]}</Text></TouchableOpacity>)}</View>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void submit()}><Text className="font-bold text-brand">确认本人食用</Text></TouchableOpacity>
        </View> : null}
      </>}
    </ScrollView>
  </Screen>;
}
