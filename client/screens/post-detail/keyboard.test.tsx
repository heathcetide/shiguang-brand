import React from "react";
import renderer, { act } from "react-test-renderer";
import { Dimensions, Keyboard, Modal, Platform, ScrollView, View, type KeyboardEvent } from "react-native";

const mockFetch = jest.fn();
const mockPost = jest.fn(async () => ({ id: 1, user_id: 1, username: "食友", content: "正文", likes_count: 0, created_at: "2026-10-01T00:00:00Z" }));
const mockRouter = { setParams: jest.fn(), push: jest.fn(), back: jest.fn() };
const mockParams = { id: 1 };
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => mockRouter, useSafeSearchParams: () => mockParams }));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 1 } }), useAuthFetch: () => mockFetch,
}));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => () => null);
jest.mock("@/components/LinkedRecipeCard", () => ({ LinkedRecipeCard: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) }));
jest.mock("@/services/api", () => ({ communityApi: {
  post: (...args: unknown[]) => mockPost(),
  comments: async () => [],
}, mediaApi: {} }));
import PostDetailScreen from "./index";

test("Android composer follows its own measured window and keeps controls outside scrolling content", async () => {
  const originalOS = Platform.OS;
  Platform.OS = "android";
  const listeners = new Map<string, (event: KeyboardEvent) => void>();
  jest.spyOn(Keyboard, "addListener").mockImplementation((name, callback) => {
    listeners.set(name, callback);
    return { remove: () => { listeners.delete(name); } };
  });
  jest.spyOn(Keyboard, "scheduleLayoutAnimation").mockImplementation(jest.fn());
  jest.spyOn(Keyboard, "metrics").mockReturnValue(undefined);
  jest.spyOn(Keyboard, "dismiss").mockImplementation(jest.fn());
  let height = 800;
  let tree!: renderer.ReactTestRenderer;
  try {
    await act(async () => {
      tree = renderer.create(<PostDetailScreen />);
    });
    const button = (label: string) => tree.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === "function")[0];
    act(() => button("发布评论").props.onPress());
    act(() => tree.root.findAllByType(Modal)[0].props.onShow());
    const layout = () => act(() => tree.root.findAllByType(View).find(node => typeof node.props.onLayout === "function")!.props.onLayout({ nativeEvent: { layout: { height } } }));
    layout();
    const frame = () => tree.root.findAllByType(View).find((node) => node.props.style?.marginBottom !== undefined)!;
    const show = (screenY: number) => act(() => listeners.get("keyboardDidShow")!({ endCoordinates: { screenY }, duration: 0 } as KeyboardEvent));
    show(510);
    expect(frame().props.style.marginBottom).toBe(290);
    expect(frame().props.style.maxHeight).toBe(486);
    // Larger IME panel; then the Modal itself resizes to the IME top.
    show(430);
    expect(frame().props.style.marginBottom).toBe(370);
    height = 430;
    layout();
    expect(frame().props.style.marginBottom).toBe(0);
    expect(frame().props.style.maxHeight).toBe(406);
    const send = button("发送评论");
    let parent = send.parent;
    while (parent && parent !== frame()) {
      expect(parent.type).not.toBe(ScrollView);
      parent = parent.parent;
    }
    expect(parent).toBe(frame());
    act(() => listeners.get("keyboardDidHide")!({} as KeyboardEvent));
    expect(frame().props.style.marginBottom).toBe(0);
    expect(frame().props.style.paddingBottom).toBe(24);
    act(() => button("取消评论").props.onPress());
    expect(listeners.size).toBe(0);
    height = 800;
    act(() => button("发布评论").props.onPress());
    act(() => tree.root.findAllByType(Modal)[0].props.onShow());
    layout();
    show(510);
    expect(frame().props.style.marginBottom).toBe(290);
    // Before onLayout fires on a fresh modal open, screen height fallback lifts the frame above the keyboard even if the activity window was resized
    act(() => button("取消评论").props.onPress());
    jest.spyOn(Dimensions, "get").mockImplementation((type) => {
      if (type === "screen") return { width: 400, height: 800, scale: 1, fontScale: 1 };
      return { width: 400, height: 510, scale: 1, fontScale: 1 };
    });
    act(() => button("发布评论").props.onPress());
    act(() => tree.root.findAllByType(Modal)[0].props.onShow());
    show(510);
    expect(frame().props.style.marginBottom).toBe(290);
    expect(frame().props.style.maxHeight).toBe(800 - 290 - 24);
  } finally {
    if (tree) act(() => tree.unmount());
    jest.restoreAllMocks();
    Platform.OS = originalOS;
  }
});

test.each([[404, "帖子未找到或已被删除"], [0, "帖子加载失败，请稍后重试"]])("distinguishes unavailable posts from load failures (%s)", async (status, message) => {
  mockPost.mockRejectedValueOnce(Object.assign(new Error("request failed"), { status }));
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  let tree!: renderer.ReactTestRenderer;
  try {
    await act(async () => { tree = renderer.create(<PostDetailScreen />); });
    expect(JSON.stringify(tree.toJSON())).toContain(message);
    const retry = tree.root.findAll(node => node.props.accessibilityLabel === "重新加载帖子" && typeof node.props.onPress === "function");
    expect(retry.length > 0).toBe(status !== 404);
    if (status !== 404) {
      await act(async () => { retry[0].props.onPress(); });
      expect(JSON.stringify(tree.toJSON())).toContain("正文");
    }
  } finally { act(() => tree.unmount()); consoleError.mockRestore(); }
});
