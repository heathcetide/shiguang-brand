import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
import { SmartDateInput } from "@/components/SmartDateInput";
import { InventoryEntryForm } from "./InventoryEntryForm";
import { blankIntakeEntry } from "./intakeEntry";
jest.mock("@/components/SmartDateInput", () => ({ SmartDateInput: () => null }));
jest.mock("@/components/ThemedFontAwesome6", () => () => null);

test("relative shortcuts route to estimates while the calendar routes to explicit dates", () => {
  const absolute = jest.fn(); const estimated = jest.fn(); const noop = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<InventoryEntryForm {...blankIntakeEntry} editingItem={null} categoryMenuOpen={false} suggestions={[]} saving={false} bottomInset={0}
    onFoodNameChange={noop} onApplySuggestion={noop} onToggleCategoryMenu={noop} onCategoryChange={noop} onQuantityChange={noop} onStorageLocationChange={noop}
    onExpirationDateChange={absolute} onEstimatedExpirationDateChange={estimated} onSelectPhoto={noop} onRemovePhoto={noop} onRequestAiRecipe={noop} onDelete={noop} onSave={noop} />); });
  for (const label of ["3 天", "7 天", "30 天"]) {
    const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label));
    act(() => button!.props.onPress());
  }
  expect(estimated).toHaveBeenCalledTimes(3); expect(absolute).not.toHaveBeenCalled();
  act(() => tree.root.findByType(SmartDateInput).props.onChange("2026-11-01"));
  expect(absolute).toHaveBeenCalledWith("2026-11-01");
  act(() => tree.unmount());
});
