import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { InventoryBulkIntakeInput } from "@dietdigidose/contracts";
import { useAuth } from "@/contexts/AuthContext";
import { getPrivateStorageGeneration } from "@/utils/userStorage";
import { inferIngredientDefaults, searchCommonIngredients } from "@/utils/ingredientRules";
import { InventoryEntryForm } from "./InventoryEntryForm";
import { blankIntakeEntry, buildIntake, changeManualEntry, type IntakeDraft, type IntakeEntry } from "./intakeEntry";
import { useIntakeDraft } from "./useIntakeDraft";

type Props = { saveIntake: (input: InventoryBulkIntakeInput) => Promise<unknown>; onSaved: () => void; onPhoto: (source: "camera" | "library") => void; photoUrl: string; bottomInset: number };
export function ManualInventoryEntry(props: Props) {
  const { user } = useAuth();
  return user ? <AccountEntry key={user.id} {...props} userId={user.id} /> : null;
}
function AccountEntry({ userId, saveIntake, onSaved, onPhoto, photoUrl, bottomInset }: Props & { userId: number }) {
  const initial: IntakeDraft = { entries: [{ ...blankIntakeEntry }], pending: null };
  const draft = useIntakeDraft("@inventory_manual_draft_v1", userId, initial);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const sending = useRef(false); const photo = useRef(photoUrl);
  const entry = draft.value.entries[0] ?? blankIntakeEntry;
  const change = (fields: Partial<IntakeEntry>, source: "user" | "rule" = "user") => {
    if (!draft.ready || draft.valueRef.current.pending) return;
    void draft.save({ entries: [changeManualEntry(draft.valueRef.current.entries[0] ?? blankIntakeEntry, fields, source)], pending: null }).catch(() => undefined);
  };
  useEffect(() => { if (photoUrl !== photo.current && draft.ready) { photo.current = photoUrl; change({ imageUrl: photoUrl }); } }, [photoUrl, draft.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (sending.current || !draft.ready) return;
    sending.current = true; setBusy(true); setError("");
    const generation = getPrivateStorageGeneration(userId);
    const current = () => draft.mounted.current && generation === getPrivateStorageGeneration(userId);
    try {
      const pending = draft.valueRef.current.pending ?? buildIntake(draft.valueRef.current.entries, Crypto.randomUUID());
      await draft.save({ ...draft.valueRef.current, pending });
      if (!current()) return;
      await saveIntake(pending);
      if (!current()) return;
      await draft.clear();
      if (current()) onSaved();
    } catch (reason) {
      if (current()) {
        if (reason && typeof reason === "object" && "status" in reason && [400, 422].includes(Number(reason.status))) await draft.save({ ...draft.valueRef.current, pending: null }).catch(() => undefined);
        setError(reason instanceof Error ? reason.message : "保存结果尚未确认，请重试；不会重复入库");
      }
    } finally { sending.current = false; if (current()) setBusy(false); }
  };
  if (!draft.ready) return <View className="p-5">{draft.error ? <Text className="text-critical">{draft.error}</Text> : <ActivityIndicator />}</View>;
  return <>
    <View className="px-5 pt-3"><Text className="text-copy-muted">{draft.value.pending ? "上次保存结果待确认。再次保存会核验同一请求，不会重复添加。" : "填写内容已按账号留在本机。数量和日期不确定时可以留空。"}</Text>{error || draft.error ? <Text accessibilityRole="alert" className="mt-2 text-critical">{error || draft.error}</Text> : null}</View>
    <InventoryEntryForm editingItem={null} {...entry} categoryMenuOpen={categoryMenuOpen} suggestions={draft.value.pending ? [] : searchCommonIngredients(entry.foodName).map(item => ({ name: item.name, category: item.category }))} saving={busy} locked={!!draft.value.pending} bottomInset={bottomInset}
      onFoodNameChange={foodName => change({ foodName })} onApplySuggestion={foodName => { const defaults = inferIngredientDefaults(foodName); change({ foodName, category: defaults.category, storageLocation: defaults.storageLocation }, "rule"); }}
      onToggleCategoryMenu={() => setCategoryMenuOpen(value => !value)} onCategoryChange={category => { change({ category }); setCategoryMenuOpen(false); }} onQuantityChange={quantity => change({ quantity })}
      onStorageLocationChange={storageLocation => change({ storageLocation })} onExpirationDateChange={expirationDate => change({ expirationDate })} onEstimatedExpirationDateChange={expirationDate => change({ expirationDate }, "rule")} onSelectPhoto={onPhoto} onRemovePhoto={() => change({ imageUrl: "" })} onRequestAiRecipe={() => undefined} onDelete={() => undefined} onSave={() => void save()} />
  </>;
}
