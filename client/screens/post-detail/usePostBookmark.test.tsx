import React from "react";
import renderer, { act } from "react-test-renderer";
import { usePostBookmark } from "./usePostBookmark";
const mockFetch = jest.fn();
const mockSetBookmark = jest.fn();
let mockUser: { id: number } | null = { id: 1 };
let mockGeneration = 1;
const mockCurrent = (id: number, generation: number) => mockUser?.id === id && mockGeneration === generation;
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, isAuthenticated: !!mockUser, sessionGeneration: mockGeneration, isSessionCurrent: mockCurrent }), useAuthFetch: () => mockFetch }));
jest.mock("@/services/api", () => ({ communityApi: { setBookmark: (...args: unknown[]) => mockSetBookmark(...args) } }));
let value!: ReturnType<typeof usePostBookmark>;
const mockWriteGeneration = { current: 0 };
const reload = jest.fn(async () => undefined);
function Probe({ id = 1, initial = false, revision = 1, readGeneration = 0 }: { id?: number; initial?: boolean; revision?: number; readGeneration?: number }) {
  const result = usePostBookmark(id, initial, reload, revision, { readGeneration, writeGeneration: mockWriteGeneration });
  React.useLayoutEffect(() => { value = result; });
  return null;
}
beforeEach(() => { mockWriteGeneration.current = 0; mockUser = { id: 1 }; mockGeneration = 1; mockSetBookmark.mockReset(); reload.mockClear(); });

test("restores initial state; serializes rapid taps and uses explicit desired state", async () => {
  let tree!: renderer.ReactTestRenderer;
  let resolve!: (value: { bookmarked: boolean }) => void;
  mockSetBookmark.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => { tree = renderer.create(<Probe initial />); });
  expect(value.bookmarked).toBe(true);
  let request!: Promise<void>;
  act(() => { request = value.setBookmark(); void value.setBookmark(); });
  expect(mockSetBookmark).toHaveBeenCalledTimes(1);
  expect(mockSetBookmark).toHaveBeenCalledWith(mockFetch, 1, false);
  expect(value.bookmarked).toBe(true); expect(value.pending).toBe(true);
  await act(async () => { resolve({ bookmarked: false }); await request; });
  expect(value.bookmarked).toBe(false);
  await act(async () => { tree.unmount(); tree = renderer.create(<Probe initial={false} />); });
  expect(value.bookmarked).toBe(false);
  act(() => tree.unmount());
});

test.each(["account", "signout", "post", "unmount"])("ignores delayed completion after %s change", async change => {
  let tree!: renderer.ReactTestRenderer; let resolve!: (value: { bookmarked: boolean }) => void;
  mockSetBookmark.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => { tree = renderer.create(<Probe />); });
  let request!: Promise<void>; act(() => { request = value.setBookmark(); });
  if (change === "account") { mockUser = { id: 2 }; mockGeneration++; }
  if (change === "signout") { mockUser = null; mockGeneration++; }
  await act(async () => { if (change === "unmount") tree.unmount(); else tree.update(<Probe id={change === "post" ? 2 : 1} />); });
  await act(async () => { resolve({ bookmarked: true }); await request; });
  if (change !== "unmount") { expect(value.bookmarked).toBe(false); act(() => tree.unmount()); }
});

test("ambiguous failure requires reread, never flips optimistically, and recovers on same-value read", async () => {
  let tree!: renderer.ReactTestRenderer;
  mockSetBookmark.mockRejectedValue(new Error("connection lost"));
  await act(async () => { tree = renderer.create(<Probe />); });
  await act(async () => { await expect(value.setBookmark()).rejects.toThrow("connection lost"); });
  expect(value.bookmarked).toBe(false); expect(value.known).toBe(false); expect(reload).toHaveBeenCalledTimes(1);
  await act(async () => { await value.setBookmark(); }); expect(mockSetBookmark).toHaveBeenCalledTimes(1);
  await act(async () => { tree.update(<Probe revision={2} readGeneration={mockWriteGeneration.current} />); }); expect(value.known).toBe(true);
  act(() => tree.unmount());
});

test("a stale detail response cannot unlock an in-flight write", async () => {
  let tree!: renderer.ReactTestRenderer; let resolve!: (value: { bookmarked: boolean }) => void;
  mockSetBookmark.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => { tree = renderer.create(<Probe initial />); });
  let request!: Promise<void>; act(() => { request = value.setBookmark(); });
  await act(async () => { tree.update(<Probe initial revision={2} />); });
  expect(value.pending).toBe(true);
  await act(async () => { await value.setBookmark(); }); expect(mockSetBookmark).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ bookmarked: false }); await request; });
  expect(value.bookmarked).toBe(false); act(() => tree.unmount());
});

test("a session invalidated before rerender cannot start a write", async () => {
  let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<Probe />); });
  mockGeneration++;
  await act(async () => { await value.setBookmark(); }); expect(mockSetBookmark).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

test.each([0, 1])("a detail GET started at generation %s cannot overwrite a later confirmed write", async readGeneration => {
  let tree!: renderer.ReactTestRenderer; let resolve!: (value: { bookmarked: boolean }) => void;
  mockSetBookmark.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => { tree = renderer.create(<Probe />); });
  let request!: Promise<void>; act(() => { request = value.setBookmark(); });
  expect(mockWriteGeneration.current).toBe(1);
  await act(async () => { resolve({ bookmarked: true }); await request; });
  expect(mockWriteGeneration.current).toBe(2); expect(value.bookmarked).toBe(true);
  // GET began either before PUT or while it was in flight, but arrives after success.
  await act(async () => { tree.update(<Probe initial={false} revision={2} readGeneration={readGeneration} />); });
  expect(value.bookmarked).toBe(true); expect(value.known).toBe(true);
  // A genuinely newer GET can still refresh a change from another device.
  await act(async () => { tree.update(<Probe initial={false} revision={3} readGeneration={2} />); });
  expect(value.bookmarked).toBe(false); act(() => tree.unmount());
});
