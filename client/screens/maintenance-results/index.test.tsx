import React from "react";
import renderer, { act } from "react-test-renderer";
const mockRequest = jest.fn(); const mockFetch = jest.fn(); let mockUser = { id: 1 };
jest.mock("@/contexts/AuthContext",() => ({ useAuth: () => ({ user: mockUser }),useAuthFetch: () => mockFetch }));
jest.mock("@/components/Screen",() => ({ Screen: "View" }));
jest.mock("@/hooks/useSafeRouter",() => ({ useSafeRouter: () => ({ back: jest.fn(),push: jest.fn() }) }));
jest.mock("@/services/api/client",() => ({ requestJson: (...args: unknown[]) => mockRequest(...args) }));
import MaintenanceResultsScreen from "./index";
const run = { id: "job",status: "failed",attempts: 3,createdAt: "2026-09-12",updatedAt: "2026-09-12",retryAt: null,applied: 0,suggested: 0,kept: 0,checks: ["核对复热"],message: "检查失败，原安排保留" };
beforeEach(() => { jest.clearAllMocks(); mockUser = { id: 1 }; });
test("failed checks are not presented as successful changes",async () => {
  mockRequest.mockResolvedValueOnce({ items: [run] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MaintenanceResultsScreen />); });
  const output = JSON.stringify(tree.toJSON());
  expect(output).toContain("检查失败"); expect(output).toContain("核对复热"); expect(output).not.toContain("已调整");
  act(() => tree.unmount());
});
test("previous account history cannot appear after switching",async () => {
  let resolve!: (value: unknown) => void;
  mockRequest.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ items: [] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MaintenanceResultsScreen />); });
  mockUser = { id: 2 }; await act(async () => { tree.update(<MaintenanceResultsScreen />); });
  await act(async () => { resolve({ items: [run] }); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("核对复热"); act(() => tree.unmount());
});


test("informational notes are displayed separately from required checks",async () => {
  mockRequest.mockResolvedValueOnce({ items: [{ ...run,status: "completed",checks: [],notes: ["每日检查已关闭，跳过该定时事件"],message: "检查已完成。" }] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MaintenanceResultsScreen />); });
  const output = JSON.stringify(tree.toJSON());
  expect(output).toContain("每日检查已关闭"); expect(output).not.toContain("待核对：");
  act(() => tree.unmount());
});
