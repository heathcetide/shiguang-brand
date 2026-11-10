import React from "react";
import renderer, { act } from "react-test-renderer";
import { ScrollView } from "react-native";

const mockPostPage = jest.fn();
const mockAuthFetch = jest.fn();
const mockRouter = { push: jest.fn() };
jest.mock("@/services/api", () => ({ communityApi: { postPage: (...args: unknown[]) => mockPostPage(...args) } }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: false }), useAuthFetch: () => mockAuthFetch }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => mockRouter }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 32, left: 0, right: 0 }) }));
jest.mock("@/hooks/useAppThemeColors", () => ({ useAppThemeColors: () => ({ brand: "#74C69D" }) }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => () => null);
jest.mock("@/components/RecipeCover", () => ({ RecipeCover: () => null }));
jest.mock("@/utils/defaultAvatar", () => ({ getAvatarSource: () => ({ uri: "avatar" }) }));

import CommunityScreen from "./index";
import { LinkedRecipeCard } from "@/components/LinkedRecipeCard";

beforeEach(() => jest.clearAllMocks());

test("scrolling near the bottom loads one page and leaves room for the floating dock", async () => {
  mockPostPage.mockResolvedValueOnce({ items: [], nextCursor: "page-two" });
  let finishPage: (page: unknown) => void = () => undefined;
  mockPostPage.mockImplementationOnce(() => new Promise((resolve) => { finishPage = resolve; }));
  let tree: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<CommunityScreen />); });
  const list = tree!.root.findAllByType(ScrollView)[0];
  expect(list.props.contentContainerStyle.paddingBottom).toBe(172);
  const event = { nativeEvent: { layoutMeasurement: { height: 600 }, contentOffset: { y: 500 }, contentSize: { height: 1200 } } };
  act(() => { list.props.onScroll(event); list.props.onScroll(event); });
  expect(mockPostPage).toHaveBeenCalledTimes(2);
  expect(mockPostPage.mock.calls[1][0]).toContain("cursor=page-two");
  expect(list.props.refreshControl.props.refreshing).toBe(false);
  await act(async () => { finishPage({ items: [], nextCursor: null }); });
  act(() => list.props.onScroll(event));
  expect(mockPostPage).toHaveBeenCalledTimes(2);
  act(() => tree!.unmount());
}, 20_000);

test("posts without an available recipe show no missing-recipe notice", () => {
  let tree: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<LinkedRecipeCard recipe={null} unavailable />); });
  expect(tree!.toJSON()).toBeNull();
});
