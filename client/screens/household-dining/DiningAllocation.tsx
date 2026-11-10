import { mealPlansApi } from "@/services/api/mealPlans";
import { useEffect, useRef, useState } from "react";
import { Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { householdDiningAllocationSchema, type HouseholdDiningMembers, type HouseholdDiningAllocationPreview, type HouseholdDiningAllocationInput } from "@dietdigidose/contracts";
import { useAuthFetch } from "@/contexts/AuthContext";
import { ApiError } from "@/services/api/client";
import { householdApi } from "@/services/api/households";

export function DiningAllocation({ householdId,members,recipeId,planItem }: { planItem?: HouseholdDiningAllocationInput["planItem"]; recipeId?: number; householdId: number; members: HouseholdDiningMembers["members"] }) {
  const apiFetch = useAuthFetch();
  const [selected,setSelected] = useState<Record<number,string>>({});
  const [preview,setPreview] = useState<HouseholdDiningAllocationPreview | null>(null);
  const [reviewed,setReviewed] = useState(false);
  const [saved,setSaved] = useState(false);
  const [message,setMessage] = useState(""); const [busy,setBusy] = useState(false);
  const generation = useRef(0); const writing = useRef(false);
  useEffect(() => () => { generation.current++; },[]);
  const calculate = async () => {
    if (writing.current) return;
    const parsed = householdDiningAllocationSchema.safeParse({ ...(recipeId ? { recipeId } : {}),...(planItem ? { planItem } : {}),participants: members.filter(member => selected[member.membershipId] !== undefined).map(member => ({ membershipId: member.membershipId,version: member.version,servings: Number(selected[member.membershipId]) })) });
    if (!parsed.success) { setMessage("请选择参与成员并填写正数份量，最多六位小数，总量不超过30份。"); return; }
    const ticket = generation.current; writing.current = true; setBusy(true); setMessage(""); setPreview(null); setReviewed(false);
    try {
      const value = await householdApi.previewDiningAllocation(apiFetch,householdId,parsed.data);
      if (ticket === generation.current) setPreview(value);
    } catch (error) { if (ticket === generation.current) setMessage(error instanceof ApiError ? error.message : "未能核算，请检查网络后重试。"); }
    finally { if (ticket === generation.current) { writing.current = false; setBusy(false); } }
  };
  const syncShopping = async (net = false) => {
    if (!preview?.planItem || !reviewed || writing.current || saved) return;
    const fingerprint = net ? preview.supply?.netShopping?.fingerprint : null;
    if (net && !fingerprint) return;
    const ticket = generation.current; writing.current = true; setBusy(true); setMessage("");
    try {
      await mealPlansApi.addShopping(apiFetch,preview.planItem.planId,preview.planItem.itemId,{ version: preview.planItem.version,idempotencyKey: fingerprint ? `dining-net:${fingerprint}` : `dining-shopping:${preview.planItem.itemId}:${preview.planItem.version}:${preview.recipeCheck?.fingerprint}`,...(fingerprint ? { householdNetFingerprint: fingerprint } : {}),householdRecipeFingerprint: preview.recipeCheck?.fingerprint,householdTotalDemand: { householdId,constraintsReviewed: true,participants: preview.participants.map(person => ({ membershipId: person.membershipId,version: person.version,servings: person.servings })) } });
      if (ticket===generation.current) { setSaved(true); setMessage(net ? "净采购调整已应用，只更新了这餐未修改的来源采购项。未扣减库存或记录食用。" : "共餐原料总需求已同步到家庭采购。未扣除库存或其他采购，请在家庭清单中核对实际补买量。"); }
    } catch (error) { if (ticket===generation.current) setMessage(error instanceof ApiError ? error.message : "同步结果尚未确认，请核对家庭清单后重试原操作。"); }
    finally { if (ticket===generation.current) { writing.current=false; setBusy(false); } }
  };
  const save = async () => {
    if (!preview?.planItem || !reviewed || writing.current || saved) return;
    const ticket = generation.current; writing.current = true; setBusy(true); setMessage("");
    try {
      const result = await mealPlansApi.updateItem(apiFetch,preview.planItem.planId,preview.planItem.itemId,{ version: preview.planItem.version,dining: { householdId,constraintsReviewed: true,participants: preview.participants.map(person => ({ membershipId: person.membershipId,version: person.version,servings: person.servings })) } });
      if (ticket !== generation.current) return;
      setSaved(true); setPreview(null);
      setMessage(result.change?.status === "pending" ? "共餐变更建议已保存，请返回个人计划审阅。" : result.change?.status === "blocked" ? "原餐次必须保留，共餐变更没有应用。" : "共餐安排已保存，请返回个人计划刷新查看。尚未记录制作或食用。");
    } catch (error) {
      if (ticket === generation.current) { setPreview(null); setMessage(`${error instanceof ApiError ? error.message : "保存结果尚未确认"}。请返回个人计划刷新核对后再操作。`); }
    } finally { if (ticket === generation.current) { writing.current = false; setBusy(false); } }
  };
  return <View className="gap-3 border-t border-border pt-4">
    <Text className="font-bold text-ink">核算一次共餐的份量</Text>
    <Text className="text-copy-muted">只选择这次参加的人。核算只预览总制作需求和忌口；核对后可另行保存共餐安排，不会记录食用。</Text>
    {planItem ? <Text className="text-copy-muted">这次预览关联所选个人餐次，会核对其版本与保护状态；不会修改原安排。</Text> : null}
    {recipeId ? <Text className="text-copy-muted">将同时检查从详情页选中的菜谱。</Text> : null}
    {members.map(member => <View key={member.membershipId} className="gap-2">
      <View className="flex-row items-center justify-between"><Text className="text-ink">{member.name}</Text><Switch accessibilityLabel={`${member.name}参与共餐`} value={selected[member.membershipId] !== undefined} disabled={busy} onValueChange={enabled => {
        setPreview(null); setReviewed(false); setSelected(value => { const next = { ...value }; if (enabled) next[member.membershipId] = "1"; else delete next[member.membershipId]; return next; });
      }} /></View>
      {selected[member.membershipId] !== undefined ? <TextInput accessibilityLabel={`${member.name}共餐份量`} keyboardType="decimal-pad" value={selected[member.membershipId]} editable={!busy} onChangeText={value => { setPreview(null); setReviewed(false); setSelected(previous => ({ ...previous,[member.membershipId]: value })); }} className="rounded-xl border border-border bg-background p-3 text-ink" /> : null}
    </View>)}
    <TouchableOpacity accessibilityRole="button" disabled={busy || saved} onPress={() => void calculate()}><Text className="font-bold text-brand">{busy ? "正在核算…" : "核算共餐需求"}</Text></TouchableOpacity>
    {message ? <Text accessibilityLiveRegion="polite" className="text-ink">{message}</Text> : null}
    {preview ? <View className="gap-2">
      {preview.planItem ? <View className="gap-2"><Text className="font-bold text-ink">{preview.planItem.plannedDate} · {({ breakfast: "早餐",lunch: "午餐",dinner: "晚餐",snack: "加餐" } as Record<string,string>)[preview.planItem.mealType] ?? preview.planItem.mealType} · {preview.planItem.title}</Text>
        <Text className="text-copy-muted">{({ apply: "此餐允许调整，但本次仅预览，未应用共餐需求",suggest: "此餐已确认或采购，需要先审阅变更建议",keep: "此餐已进入执行或已完成，原安排必须保留" })[preview.planItem.decision]}</Text></View> : null}
      {preview.recipeCheck ? <View className="gap-2">
        <Text className="font-bold text-ink">{preview.recipeCheck.title}：{preview.recipeCheck.status === "blocked" ? "有已知忌口冲突，不适合当前共餐" : "尚需核对，未确认符合全部忌口"}</Text>
        {preview.recipeCheck.conflicts.map((conflict,index) => <Text key={index} className="text-ink">{preview.participants.find(person => person.membershipId === conflict.membershipId)?.name}：{conflict.constraint}</Text>)}
        <Text className="font-bold text-ink">共餐原料总需求</Text>
        {preview.recipeCheck.materials.status === "known" ? preview.recipeCheck.materials.demands.map((item,index) => <Text key={index} className="text-copy-muted">{item.food_name}：{item.amount_value} {({ piece: "个",serving: "份",bag: "袋",box: "盒",bottle: "瓶",can: "罐" } as Record<string,string>)[item.unit] ?? item.unit}</Text>) : <Text className="text-copy-muted">用量不完整，请核对菜谱份数与配料后再安排采购。</Text>}
        {preview.recipeCheck.checks.map((check,index) => <Text key={index} className="text-copy-muted">{check}</Text>)}
      </View> : null}
      {preview.planItem && preview.planItem.decision !== "keep" && preview.recipeCheck?.status === "needs_review" ? <View className="gap-2">
        <View className="flex-row items-center justify-between"><Text className="flex-1 text-copy-muted">已逐人核对共享忌口、配料与实际制作条件</Text><Switch accessibilityLabel="已核对共餐限制" value={reviewed} disabled={busy} onValueChange={setReviewed} /></View>
        {preview.recipeCheck?.materials.status === "known" ? <><Text className="text-copy-muted">采购同步仅用于与已保存安排完全一致的预览，按下列原料总需求加入家庭清单，不抵扣现有库存或其他采购项。请核对后选择。</Text><TouchableOpacity accessibilityRole="button" disabled={busy || !reviewed || saved} onPress={() => void syncShopping()}><Text className="font-bold text-brand">按此总需求同步家庭采购</Text></TouchableOpacity></> : null}
        <TouchableOpacity accessibilityRole="button" disabled={busy || !reviewed || saved} onPress={() => void save()}><Text className="font-bold text-brand">保存这餐的共餐安排</Text></TouchableOpacity>
      </View> : null}
      {preview.supply ? <View className="gap-2">
        <Text className="font-bold text-ink">同名家庭库存核算{preview.supply.status === "needs_review" ? "：待核对" : ""}</Text>
        <Text className="text-copy-muted">已考虑另外 {preview.supply.otherMealCount} 个共餐餐次，先保留受保护餐次的需求，再按日期分配；本次不预留或扣减库存。</Text>
        {preview.supply.demands.map((demand,index) => <Text key={index} className="text-copy-muted">{demand.food_name}：{demand.covered === null || demand.missing === null ? "暂不能确定可用量与缺口" : `库存可覆盖 ${demand.covered} ${demand.unit}，库存缺口 ${demand.missing} ${demand.unit}`}</Text>)}
        {preview.supply.demands.map((demand,index) => <Text key={`shopping-${index}`} className="text-copy-muted">{demand.food_name}：{demand.shoppingCovered == null || demand.unplanned == null ? "清单覆盖与尚未安排量待核对" : `清单已列入 ${demand.shoppingCovered} ${demand.unit}，尚未安排 ${demand.unplanned} ${demand.unit}`}</Text>)}
        {preview.supply.netShopping ? <View className="gap-2">
          <Text className="font-bold text-ink">这餐的净采购调整</Text>
          <Text className="text-copy-muted">以下数量替换这餐未改动的自动采购项，已抵扣分配到这餐的库存和其他清单数量。提交时重新核对全部来源。</Text>
          {preview.supply.netShopping.lines.map(line => <Text key={line.key} className="text-copy-muted">{line.name}：{line.beforeAmount ?? "未列入"} → {line.afterAmount ?? "移除，无需补买"}</Text>)}
          {preview.supply.netShopping.checks.map((check,index) => <Text key={index} className="text-copy-muted">{check}</Text>)}
          {preview.supply.netShopping.status === "ready" ? <TouchableOpacity accessibilityRole="button" disabled={busy || !reviewed || saved || preview.planItem?.decision === "keep"} onPress={() => void syncShopping(true)}><Text className="font-bold text-brand">应用上述净采购调整</Text></TouchableOpacity> : null}
        </View> : null}
        {preview.supply.checks.map((check,index) => <Text key={index} className="text-copy-muted">{check}</Text>)}
        <Text className="text-copy-muted">清单数量是采购安排，不代表已入库或可食用。净采购根据当前原料库存与清单计算；待吃成品不折算成原料，提交后仍需随实际消耗核对。</Text>
      </View> : null}
      <Text className="font-bold text-ink">共需 {preview.totalServings} 份</Text>
      {preview.participants.map(person => <Text key={person.membershipId} className="text-copy-muted">{person.name}：{person.servings} 份</Text>)}
      <Text className="text-copy-muted">需避开的过敏原：{preview.allergies.join("、") || "未填写，请逐人确认"}</Text>
      <Text className="text-copy-muted">需遵守的限制：{preview.restrictions.join("、") || "未填写，请逐人确认"}</Text>
      <Text className="text-copy-muted">尚需按这些要求核对菜谱、配料和制作条件。计划份量不是实际摄入。</Text>
    </View> : null}
  </View>;
}
