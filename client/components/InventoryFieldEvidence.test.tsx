import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { InventoryFieldEvidence } from "./InventoryFieldEvidence";

test("shows each field's own uncertainty and source without treating missing evidence as confirmed", () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<InventoryFieldEvidence evidence={{
    food_name: { status: "known", source: "recognition" },
    quantity: { status: "estimated", source: "recognition", note: "包装未打开" },
    storage_location: { status: "known", source: "user" },
    expiration_date: { status: "estimated", source: "rule" },
  }} />); });
  const labels = () => tree.root.findAllByType(Text).map(node => node.props.children.flat().join(""));
  expect(labels()).toEqual(["名称：已知 · 识别结果", "数量：估计 · 识别结果 · 包装未打开", "位置：已知 · 用户填写", "到期日期：估计 · 规则建议"]);
  act(() => { tree.update(<InventoryFieldEvidence />); });
  expect(labels()).toEqual(["名称：未知 · 来源未知", "数量：未知 · 来源未知", "位置：未知 · 来源未知", "到期日期：未知 · 来源未知"]);
  act(() => tree.unmount());
});
