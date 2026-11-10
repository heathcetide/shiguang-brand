import React from "react";
import renderer, { act } from "react-test-renderer";
import { inventoryApi } from "@/services/api";
import { SavedInventoryEvidence } from "./SavedInventoryEvidence";
jest.mock("@/services/api", () => ({ inventoryApi: { evidence: jest.fn() } }));
const fetcher = jest.fn();
const response = (id: number, note: string, version = 1) => ({ item_id: id, inventory_version: version, field_evidence: { food_name: { status: "known", source: "recognition", note } } });
function deferred() { let resolve!: (value: any) => void; let reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => jest.clearAllMocks());
test("new item/account requests hide previous evidence immediately and ignore old completions", async () => {
  const first = deferred(), second = deferred(), third = deferred();
  (inventoryApi.evidence as jest.Mock).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<SavedInventoryEvidence itemId={1} version={1} accountScope="one" authFetch={fetcher} />); });
  await act(async () => { tree.update(<SavedInventoryEvidence itemId={2} version={1} accountScope="one" authFetch={fetcher} />); });
  await act(async () => { second.resolve(response(2, "新食材")); });
  expect(JSON.stringify(tree.toJSON())).toContain("新食材");
  await act(async () => { first.resolve(response(1, "过期回包")); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("过期回包");
  await act(async () => { tree.update(<SavedInventoryEvidence itemId={2} version={1} accountScope="two" authFetch={fetcher} />); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("新食材");
  await act(async () => { third.reject(new Error("offline")); });
  expect(JSON.stringify(tree.toJSON())).toContain("依据暂不可用");
  await act(async () => tree.unmount());
});
test("reopening fetches online again and mismatched item/version responses remain unavailable", async () => {
  (inventoryApi.evidence as jest.Mock).mockResolvedValueOnce(response(1, "第一回")).mockResolvedValueOnce(response(1, "旧版本", 2));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<SavedInventoryEvidence itemId={1} version={1} accountScope="one" authFetch={fetcher} />); });
  expect(JSON.stringify(tree.toJSON())).toContain("第一回");
  await act(async () => tree.unmount());
  await act(async () => { tree = renderer.create(<SavedInventoryEvidence itemId={1} version={1} accountScope="one" authFetch={fetcher} />); });
  expect(inventoryApi.evidence).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(tree.toJSON())).toContain("依据暂不可用");
  expect(JSON.stringify(tree.toJSON())).not.toContain("旧版本");
  await act(async () => tree.unmount());
});
