import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useCSSVariable } from "uniwind";

import type { DetectedFood, InventoryItem, KitchenwareCatalogItem } from "./types";
import { COMMON_INGREDIENTS, type CommonIngredient } from "@/utils/ingredientRules";
import type { InventoryLogEntry } from "@/utils/inventoryHistory";
import { InventoryFieldEvidence } from "@/components/InventoryFieldEvidence";
import { SmartDateInput } from "@/components/SmartDateInput";

export type ExpiredCleanupResult = {
  succeeded: number;
  failed: number;
};

interface ExpiredCleanupModalProps {
  visible: boolean;
  items: InventoryItem[];
  clearing: boolean;
  result: ExpiredCleanupResult | null;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}

export function ExpiredCleanupModal({
  visible,
  items,
  clearing,
  result,
  onClose,
  onConfirm,
  onRetry,
}: ExpiredCleanupModalProps) {
  const previewNames = items.slice(0, 3).map((item) => item.food_name).join("、");
  const remainingCount = Math.max(0, items.length - 3);
  const fullyCleared = result !== null && result.failed === 0;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={clearing ? undefined : onClose}>
      <View className="flex-1 items-center justify-center bg-black/45 px-5">
        <View className="w-full max-w-md rounded-[28px] bg-surface p-5 shadow-lg" accessibilityViewIsModal>
          <View className={`h-12 w-12 items-center justify-center rounded-2xl ${result ? (fullyCleared ? "bg-brand/10" : "bg-warm-soft") : "bg-danger-soft"}`}>
            <FontAwesome6
              name={result ? (fullyCleared ? "check" : "triangle-exclamation") : "trash-can"}
              size={17}
              colorClassName={result ? (fullyCleared ? "accent-brand" : "accent-warm") : "accent-critical"}
            />
          </View>

          {result ? (
            <>
              <Text className="mt-4 text-lg font-black text-ink">
                {fullyCleared ? "清理完成" : "部分食材未能清理"}
              </Text>
              <Text className="mt-2 text-sm leading-5 text-copy-muted">
                已成功移除 {result.succeeded} 种食材
                {result.failed > 0 ? `，另有 ${result.failed} 种处理失败并保留在列表中。` : "，库存列表与操作历史已同步更新。"}
              </Text>
              <View className="mt-5 flex-row gap-2.5">
                {result.failed > 0 ? (
                  <>
                    <TouchableOpacity onPress={onClose} className="min-h-touch flex-1 items-center justify-center rounded-2xl border border-line bg-canvas">
                      <Text className="text-sm font-bold text-copy-muted">稍后处理</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={onRetry} className="min-h-touch flex-1 items-center justify-center rounded-2xl bg-brand-fill">
                      <Text className="text-sm font-black text-white">重试 {result.failed} 种</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity onPress={onClose} className="min-h-touch flex-1 items-center justify-center rounded-2xl bg-brand-fill">
                    <Text className="text-sm font-black text-white">完成</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          ) : (
            <>
              <Text className="mt-4 text-lg font-black text-ink">清理已过期食材</Text>
              <Text className="mt-2 text-sm leading-5 text-copy-muted">
                将从保鲜库移除 {items.length} 种已过期食材，此操作会记入库存变动历史。
              </Text>
              {previewNames ? (
                <View className="mt-3 rounded-2xl bg-danger-soft px-3.5 py-3">
                  <Text className="text-xs font-bold leading-5 text-critical">
                    {previewNames}{remainingCount > 0 ? ` 等 ${items.length} 种` : ""}
                  </Text>
                </View>
              ) : null}
              <View className="mt-5 flex-row gap-2.5">
                <TouchableOpacity
                  onPress={onClose}
                  disabled={clearing}
                  className="min-h-touch flex-1 items-center justify-center rounded-2xl border border-line bg-canvas disabled:opacity-50"
                >
                  <Text className="text-sm font-bold text-copy-muted">取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onConfirm}
                  disabled={clearing || items.length === 0}
                  className="min-h-touch flex-1 flex-row items-center justify-center rounded-2xl bg-critical-fill disabled:opacity-50"
                >
                  {clearing ? (
                    <>
                      <ActivityIndicator size="small" colorClassName="accent-on-brand" />
                      <Text className="ml-2 text-sm font-black text-white">正在清理</Text>
                    </>
                  ) : (
                    <Text className="text-sm font-black text-white">确认清理 {items.length} 种</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

interface BatchReviewModalProps {
  locked?: boolean;
  error?: string;
  visible: boolean;
  foods: DetectedFood[];
  saving: boolean;
  onClose: () => void;
  onChange: (foods: DetectedFood[]) => void;
  onSave: () => void;
  onAddItem?: (item: CommonIngredient) => void;
  onMergeDuplicates?: () => void;
}

export function BatchReviewModal({ visible, foods, saving, locked = false, error, onClose, onChange: changeFoods, onSave, onAddItem, onMergeDuplicates }: BatchReviewModalProps) {
  const [brand, muted] = useCSSVariable(["--color-brand", "--color-copy-muted"]) as string[];
  const onChange = (next: DetectedFood[]) => { if (!locked && !saving) changeFoods(next); };
  const allSelected = foods.length > 0 && foods.every((food) => food.selected);
  const selectedCount = foods.filter((food) => food.selected).length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[88%] rounded-t-[32px] bg-surface px-page pt-page pb-6" accessibilityViewIsModal>
          <View className="flex-row items-start justify-between border-b border-line pb-4">
            <View className="flex-1 pr-3">
              <Text className="text-lg font-black text-ink" accessibilityRole="header">批量确认识别结果</Text>
              <Text className="mt-1 text-caption leading-4 text-copy-muted">已添加 {foods.length} 种食材；取消勾选不需要入库的项目。</Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="关闭识别结果" className="min-h-touch min-w-touch items-center justify-center rounded-full bg-canvas">
              <FontAwesome6 name="xmark" size={17} color={muted} />
            </TouchableOpacity>
          </View>

          {error ? <Text accessibilityRole="alert" className="mt-3 text-xs text-critical">{error}</Text> : null}
          {!locked && onAddItem && (
            <View className="mt-3">
              <Text className="text-xs font-bold text-copy-muted mb-1.5">快捷加一项</Text>
              <View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                  {COMMON_INGREDIENTS.slice(0, 10).map((item) => (
                  <TouchableOpacity
                    key={item.name}
                    onPress={() => onAddItem(item)}
                    className="flex-row items-center gap-1.5 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5"
                  >
                    <FontAwesome6 name="plus" size={10} colorClassName="accent-brand" />
                    <Text className="text-xs font-bold text-brand">{item.name}</Text>
                  </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          )}
          {!locked && onMergeDuplicates ? (
            <TouchableOpacity onPress={onMergeDuplicates} className="mt-2 self-start rounded-full bg-background-secondary px-3 py-2">
              <Text className="text-[10px] font-black text-copy-muted">检查重复项目（同名批次分别保留）</Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView className="mt-3" showsVerticalScrollIndicator={false} contentContainerClassName="gap-2 pb-3" accessibilityLiveRegion="polite">
            {foods.map((item) => (
              <View
                key={item.id}
                pointerEvents={locked || saving ? "none" : "auto"}
                className={`rounded-card border p-3.5 ${item.selected ? "border-brand/30 bg-brand-soft" : "border-line bg-canvas opacity-disabled"}`}
              >
                <View className="flex-row items-center">
                  <TouchableOpacity
                    onPress={() => onChange(foods.map((food) => food.id === item.id ? { ...food, selected: !food.selected } : food))}
                    className={`mr-3 h-6 w-6 items-center justify-center rounded-full ${item.selected ? "bg-brand-fill" : "border border-line bg-surface"}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.selected }}
                  >
                    {item.selected && <FontAwesome6 name="check" size={11} colorClassName="accent-on-brand" />}
                  </TouchableOpacity>
                  <TextInput
                    value={item.foodName}
                    onChangeText={(foodName) => onChange(foods.map((food) => food.id === item.id ? { ...food, foodName, fieldEvidence: { ...food.fieldEvidence, food_name: { status: "known", source: "user" } } } : food))}
                    editable={item.selected && !locked && !saving}
                    className="h-10 min-w-0 flex-1 text-body font-black text-ink"
                    accessibilityLabel="食材名称"
                  />
                  <TouchableOpacity onPress={() => onChange(foods.filter((food) => food.id !== item.id))} accessibilityLabel={`删除${item.foodName}`} className="h-9 w-9 items-center justify-center">
                    <FontAwesome6 name="trash-can" size={11} colorClassName="accent-critical" />
                  </TouchableOpacity>
                </View>
                {item.selected ? (
                  <View className="mt-2 gap-2">
                    <View className="flex-row gap-2">
                      <View className="flex-1 rounded-xl bg-surface px-3">
                        <Text className="pt-2 text-[9px] font-bold text-copy-muted">{item.fieldEvidence?.quantity?.status === "estimated" ? "数量与单位（识别估计）" : "数量与单位"}</Text>
                        <TextInput
                          value={item.quantity}
                          editable={!locked && !saving}
                          onChangeText={(quantity) => onChange(foods.map((food) => food.id === item.id ? { ...food, quantity, fieldEvidence: { ...food.fieldEvidence, quantity: { status: quantity.trim() ? "known" : "unknown", source: "user" } }, missingFields: quantity.trim() ? food.missingFields?.filter(field => field !== "数量") : food.missingFields } : food))}
                          placeholder="数量未知可留空"
                          placeholderTextColorClassName="accent-copy-muted"
                          className="h-9 text-xs font-black text-ink"
                        />
                      </View>
                      <View className="flex-1">
                        <SmartDateInput
                          label={item.fieldEvidence?.expiration_date?.status === "estimated" ? "到期日期（建议）" : "到期日期"}
                          value={item.expirationDate || ""}
                          onChange={(expirationDate) => onChange(foods.map((food) => food.id === item.id ? { ...food, expirationDate, fieldEvidence: { ...food.fieldEvidence, expiration_date: { status: expirationDate ? "known" : "unknown", source: "user" } }, missingFields: expirationDate ? food.missingFields?.filter(field => !["保质期", "到期日期"].includes(field)) : food.missingFields } : food))}
                          placeholder="未知可留空"
                          disabled={locked || saving}
                        />
                      </View>
                    </View>
                    <View className="flex-row gap-1.5">
                      {(["冷藏", "冷冻", "常温"] as const).map((location) => (
                        <TouchableOpacity
                          key={location}
                          onPress={() => onChange(foods.map((food) => food.id === item.id ? { ...food, suggestedStorageLocation: location, fieldEvidence: { ...food.fieldEvidence, storage_location: { status: "known", source: "user" } }, missingFields: food.missingFields?.filter(field => field !== "存放位置") } : food))}
                          className={`rounded-full px-3 py-1.5 ${item.suggestedStorageLocation === location ? "bg-brand-fill" : "bg-surface"}`}
                        >
                          <Text className={`text-[9px] font-black ${item.suggestedStorageLocation === location ? "text-white" : "text-copy-muted"}`}>{location}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-[9px] text-copy-muted">来源：{item.source === "barcode" ? "条码" : item.source === "receipt" ? "小票" : "图片"}</Text>
                      <Text className={`text-[9px] font-black ${(item.confidence ?? 0) < 0.8 ? "text-critical" : "text-brand"}`}>
                        {item.confidence == null ? "置信度待确认" : `置信度 ${Math.round(item.confidence * 100)}%`}
                      </Text>
                    </View>
                    <InventoryFieldEvidence evidence={item.fieldEvidence} />
                    {item.missingFields?.length ? <Text className="text-[9px] font-bold text-critical">待确认：{item.missingFields.join("、")}</Text> : null}
                  </View>
                ) : (
                  <Text className="mt-1 text-caption text-copy-muted">已排除，不会入库</Text>
                )}
              </View>
            ))}
          </ScrollView>

          <View className="mt-3 flex-row gap-3">
            <TouchableOpacity
              onPress={() => onChange(foods.map((item) => ({ ...item, selected: !allSelected })))}
              className="min-h-touch items-center justify-center rounded-control border border-line bg-canvas px-4"
              accessibilityRole="checkbox"
              disabled={locked || saving}
              accessibilityState={{ checked: allSelected, disabled: locked || saving }}
              accessibilityLabel="全选识别结果"
            >
              <Text className="text-caption font-bold text-copy-muted">全选</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSave}
              disabled={saving || selectedCount === 0}
              className="flex-1 min-h-touch items-center justify-center rounded-control bg-brand-fill active:bg-accent-hover disabled:opacity-disabled"
              accessibilityRole="button"
              accessibilityLabel={`一键批量入库 ${selectedCount} 项`}
              accessibilityState={{ disabled: saving || selectedCount === 0, busy: saving }}
            >
              {saving ? <ActivityIndicator colorClassName="accent-on-brand" /> : <Text className="text-base font-black text-white">一键批量入库 {selectedCount} 项</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface InventoryHistoryModalProps {
  visible: boolean;
  logs: InventoryLogEntry[];
  onClose: () => void;
  onClear: () => void;
}

export function InventoryHistoryModal({ visible, logs, onClose, onClear }: InventoryHistoryModalProps) {
  const [muted] = useCSSVariable(["--color-copy-muted"]) as string[];

  const getActionBadge = (action: InventoryLogEntry["action"]) => {
    switch (action) {
      case "add":
        return { text: "录入", bg: "bg-success-soft", textColor: "text-success" };
      case "consume":
        return { text: "用完", bg: "bg-warm-soft", textColor: "text-warm" };
      case "expire_clear":
        return { text: "清理", bg: "bg-danger-soft", textColor: "text-critical" };
      default:
        return { text: "修改", bg: "bg-info-soft", textColor: "text-info" };
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hours}:${mins}`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[85%] rounded-t-[32px] bg-surface px-5 pt-5 pb-6">
          <View className="flex-row items-center justify-between border-b border-line pb-3">
            <View className="flex-1">
              <Text className="text-lg font-black text-ink">库存变动历史</Text>
              <Text className="mt-0.5 text-xs text-copy-muted">记录你的每一次录入、用完扣减与清理</Text>
            </View>
            <View className="flex-row items-center gap-2">
              {logs.length > 0 && (
                <TouchableOpacity onPress={onClear} className="px-3 py-1.5 rounded-full bg-canvas border border-line">
                  <Text className="text-xs font-bold text-copy-muted">清空历史</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-full bg-canvas">
                <FontAwesome6 name="xmark" size={16} color={muted} />
              </TouchableOpacity>
            </View>
          </View>

          {logs.length === 0 ? (
            <View className="py-12 items-center">
              <FontAwesome6 name="clock-rotate-left" size={32} colorClassName="accent-warm" />
              <Text className="mt-3 text-xs font-bold text-copy-muted">暂无变动记录</Text>
              <Text className="mt-1 text-[11px] text-copy-muted">录入或扣减食材后会在此处自动记录</Text>
            </View>
          ) : (
            <ScrollView className="mt-3" showsVerticalScrollIndicator={false} contentContainerClassName="gap-2.5 pb-4">
              {logs.map((log) => {
                const badge = getActionBadge(log.action);
                return (
                  <View key={log.id} className="flex-row items-center justify-between rounded-2xl border border-line bg-canvas p-3.5">
                    <View className="flex-row items-center gap-3">
                      <View className={`px-2.5 py-1 rounded-full ${badge.bg}`}>
                        <Text className={`text-[11px] font-black ${badge.textColor}`}>{badge.text}</Text>
                      </View>
                      <View>
                        <Text className="text-sm font-black text-ink">{log.foodName}</Text>
                        <Text className="mt-0.5 text-[11px] text-copy-muted">{log.quantity} · {log.storageLocation}</Text>
                      </View>
                    </View>
                    <Text className="text-[10px] font-medium text-copy-muted">{formatTime(log.timestamp)}</Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

interface CatalogDetailModalProps {
  item: KitchenwareCatalogItem | null;
  saving: boolean;
  owned: boolean;
  onClose: () => void;
  onAdd: (item: KitchenwareCatalogItem) => void;
}

export function CatalogDetailModal({ item, saving, owned, onClose, onAdd }: CatalogDetailModalProps) {
  const [muted] = useCSSVariable(["--color-copy-muted"]) as string[];
  if (!item) return null;
  const aliases = parseCatalogList(item.aliases);
  const cookingMethods = parseCatalogList(item.cooking_methods);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 p-page">
        <View className="w-full rounded-[28px] bg-surface p-page" accessibilityViewIsModal>
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-lg font-black text-ink" accessibilityRole="header">{item.name}</Text>
              <Text className="mt-1 text-caption font-bold text-brand">官方标准库 · {item.category}</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="min-h-touch min-w-touch items-center justify-center" accessibilityRole="button" accessibilityLabel={`关闭${item.name}详情`}>
              <FontAwesome6 name="xmark" size={17} color={muted} />
            </TouchableOpacity>
          </View>
          {aliases.length ? <View className="mt-4"><Text className="text-caption font-bold text-copy-muted">常用别名</Text><Text className="mt-1 text-caption text-ink">{aliases.join("、")}</Text></View> : null}
          <View className="mt-4"><Text className="text-caption font-bold text-copy-muted">适用方式</Text><Text className="mt-1 text-caption text-ink">{cookingMethods.join("、") || "暂未标注"}</Text></View>
          <View className="mt-4 rounded-card bg-background-secondary p-3"><Text className="text-caption font-bold text-copy-muted">官方保养提示</Text><Text className="mt-1 text-caption leading-5 text-ink">{item.care_note || "保持清洁干燥，按产品说明书进行保养。"}</Text></View>
          <TouchableOpacity
            disabled={saving || owned}
            onPress={() => onAdd(item)}
            className="mt-5 min-h-touch items-center justify-center rounded-control bg-brand-fill disabled:opacity-disabled"
            accessibilityRole="button"
            accessibilityState={{ disabled: saving || owned, busy: saving }}
            accessibilityLabel={owned ? `${item.name}已在我的装备库` : `将${item.name}加入我的装备`}
          >
            <Text className="text-body font-black text-white">{saving ? "添加中…" : owned ? "已在我的装备库" : "加入我的装备"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function parseCatalogList(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
