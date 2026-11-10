import React from "react";
import renderer, { act } from "react-test-renderer";
import { Platform, StyleSheet, Text, TouchableOpacity } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SmartDateInput } from "@/components/SmartDateInput";
import { ManualInventoryEntry } from "./ManualInventoryEntry";
import { InventoryEntryForm } from "./InventoryEntryForm";
const mockStorage = new Map<string, string>();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: (key: string) => Promise.resolve(mockStorage.get(key) ?? null) }));
jest.mock("@/utils/userStorage", () => ({
  getPrivateStorageGeneration: () => 0, getUserStorageKey: (key: string, id: number) => `${key}:user:${id}`,
  writeUserPrivateStorage: async (key: string, id: number, _generation: number, value: string) => { mockStorage.set(`${key}:user:${id}`, value); return true; },
  removeUserPrivateStorage: async () => true,
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000002" }));
jest.mock("@/hooks/useAppThemeColors", () => ({ useAppThemeColors: () => ({}) }));
jest.mock("@/contexts/ThemeContext", () => ({ useThemePreference: () => ({ resolvedTheme: "light" }) }));
jest.mock("@/components/ThemedFontAwesome6", () => () => null);
jest.mock("@react-native-community/datetimepicker", () => () => null);
afterEach(() => { jest.restoreAllMocks(); mockStorage.clear(); });

test("real Web date input clearing removes the manual date and its submitted user evidence", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  const saveIntake = jest.fn().mockResolvedValue({});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ManualInventoryEntry saveIntake={saveIntake} onSaved={jest.fn()} onPhoto={jest.fn()} photoUrl="" bottomInset={0} />); });
  await act(async () => { tree.root.findByProps({ nativeID: "inventory-food-name" }).props.onChangeText("番茄"); });
  await act(async () => { tree.root.findByType("input").props.onChange({ target: { value: "2026-11-01" } }); });
  const draft = () => JSON.parse(mockStorage.get("@inventory_manual_draft_v1:user:1")!);
  expect(draft().entries[0].fieldEvidence.expiration_date).toEqual({ status: "known", source: "user" });
  await act(async () => { tree.root.findByType("input").props.onChange({ target: { value: "" } }); });
  expect(tree.root.findByType("input").props.value).toBe("");
  expect(draft().entries[0].expirationDate).toBe("");
  expect(draft().entries[0].fieldEvidence.expiration_date).toBeUndefined();
  await act(async () => { tree.root.findByType(InventoryEntryForm).props.onSave(); });
  const item = saveIntake.mock.calls[0][0].items[0];
  expect(item.expiration_date).toBe(""); expect(item.field_evidence.expiration_date).toBeUndefined();
  act(() => tree.unmount());
});

test("invalid Web input and native dismissal do not turn into clear events", () => {
  const onChange = jest.fn(); let tree!: renderer.ReactTestRenderer;
  jest.replaceProperty(Platform, "OS", "web");
  act(() => { tree = renderer.create(<SmartDateInput value="2026-11-01" onChange={onChange} />); });
  act(() => tree.root.findByType("input").props.onChange({ target: { value: "invalid-date" } }));
  expect(onChange).not.toHaveBeenCalled(); act(() => tree.unmount());
  jest.replaceProperty(Platform, "OS", "android");
  act(() => { tree = renderer.create(<SmartDateInput value="2026-11-01" onChange={onChange} />); });
  act(() => tree.root.findByType(TouchableOpacity).props.onPress());
  act(() => tree.root.findByType(DateTimePicker).props.onChange({ type: "dismissed" }));
  expect(onChange).not.toHaveBeenCalled(); act(() => tree.unmount());
});

test("native calendar cancellation preserves estimated evidence until an explicit date is confirmed", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  const saveIntake = jest.fn().mockResolvedValue({});
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ManualInventoryEntry saveIntake={saveIntake} onSaved={jest.fn()} onPhoto={jest.fn()} photoUrl="" bottomInset={0} />); });
  try {
    await act(async () => { tree.root.findByProps({ nativeID: "inventory-food-name" }).props.onChangeText("番茄"); });
    const draft = () => JSON.parse(mockStorage.get("@inventory_manual_draft_v1:user:1")!).entries[0];
    const open = () => act(() => tree.root.findByType(SmartDateInput).findByType(TouchableOpacity).props.onPress());
    open();
    await act(async () => tree.root.findByType(DateTimePicker).props.onChange({ type: "dismissed" }));
    expect(draft().expirationDate).toBe("");
    expect(draft().fieldEvidence.expiration_date).toBeUndefined();
    const shortcut = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === "3 天"))!;
    await act(async () => shortcut.props.onPress());
    const estimated = draft().expirationDate;
    open();
    const cancelled = tree.root.findByType(DateTimePicker).props.onChange;
    await act(async () => cancelled({ type: "dismissed" }));
    expect(draft().expirationDate).toBe(estimated);
    expect(draft().fieldEvidence.expiration_date).toEqual({ status: "estimated", source: "rule" });
    open();
    await act(async () => cancelled({ type: "set" }, new Date(2026, 10, 9)));
    expect(draft().expirationDate).toBe(estimated);
    expect(draft().fieldEvidence.expiration_date).toEqual({ status: "estimated", source: "rule" });
    await act(async () => tree.root.findByType(DateTimePicker).props.onChange({ type: "set" }, new Date(2026, 10, 2)));
    expect(draft().expirationDate).toBe("2026-11-02");
    expect(draft().fieldEvidence.expiration_date).toEqual({ status: "known", source: "user" });
    expect(saveIntake).not.toHaveBeenCalled();
    const dateButton = tree.root.findByType(SmartDateInput).findByType(TouchableOpacity);
    expect(StyleSheet.flatten(dateButton.props.style).height).toBeUndefined();
    expect(StyleSheet.flatten(dateButton.props.style).minHeight).toBeGreaterThanOrEqual(48);
    await act(async () => { tree.root.findByType(InventoryEntryForm).props.onSave(); });
    expect(saveIntake.mock.calls[0][0].items[0]).toMatchObject({ expiration_date: "2026-11-02", field_evidence: { expiration_date: { status: "known", source: "user" } } });
  } finally { act(() => tree.unmount()); }
});
