import React from "react";
import renderer from "react-test-renderer";
import { FlatList, Keyboard, Modal, Platform, ScrollView, SectionList, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareFlatList, KeyboardAwareScrollView, KeyboardAwareSectionList } from "react-native-keyboard-aware-scroll-view";

let mockIsFocused = false;
let mockBottomInset = 0;

jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockIsFocused }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: mockBottomInset, left: 0 }),
}));
jest.mock("uniwind", () => ({ withUniwind: (component: unknown) => component, useCSSVariable: () => "#111713", useUniwind: () => ({ theme: "dark" }) }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-keyboard-aware-scroll-view", () => {
  const ReactModule = require("react");
  const Native = require("react-native");
  return {
    KeyboardAwareScrollView: (props: Record<string, unknown>) => ReactModule.createElement(Native.View, { ...props, ref: props.innerRef }),
    KeyboardAwareFlatList: (props: Record<string, unknown>) => ReactModule.createElement(Native.View, { ...props, ref: props.innerRef }),
    KeyboardAwareSectionList: (props: Record<string, unknown>) => ReactModule.createElement(Native.View, { ...props, ref: props.innerRef }),
  };
});

import { Screen } from "./Screen";

test("inactive screens hide their full accessibility tree", () => {
  let tree: renderer.ReactTestRenderer;
  renderer.act(() => {
    tree = renderer.create(<Screen><Text>非活动页面</Text></Screen>);
  });
  const wrapper = tree!.root.findAllByType(View)[0];
  expect(wrapper.props.accessibilityElementsHidden).toBe(true);
  expect(wrapper.props.importantForAccessibility).toBe("no-hide-descendants");
  expect(wrapper.props["aria-hidden"]).toBe(true);

  mockIsFocused = true;
  renderer.act(() => tree!.update(<Screen><Text>活动页面</Text></Screen>));
  const focusedWrapper = tree!.root.findAllByType(View)[0];
  expect(focusedWrapper.props.accessibilityElementsHidden).toBe(false);
  expect(focusedWrapper.props.importantForAccessibility).toBe("auto");
});

test("resolves the native page background to a concrete theme color", () => {
  let tree: renderer.ReactTestRenderer;
  renderer.act(() => { tree = renderer.create(<Screen><Text>深色页面</Text></Screen>); });
  expect(tree!.root.findAllByType(View)[0].props.style.backgroundColor).toBe("#111713");
  renderer.act(() => { tree!.update(<Screen backgroundColor="#123456"><Text>自定义背景</Text></Screen>); });
  expect(tree!.root.findAllByType(View)[0].props.style.backgroundColor).toBe("#123456");
});

test("adds scrolling for plain content and keeps fixed siblings outside an existing scroll view", () => {
  let tree: renderer.ReactTestRenderer;
  const body = <Text>正文</Text>;
  const footer = <Text>固定操作</Text>;
  renderer.act(() => { tree = renderer.create(<Screen>{body}</Screen>); });
  expect(tree!.root.findByType(KeyboardAwareScrollView).props.children).toBe(body);

  renderer.act(() => {
    tree!.update(<Screen><ScrollView keyboardShouldPersistTaps="always">{body}</ScrollView>{footer}</Screen>);
  });
  const scroll = tree!.root.findByType(KeyboardAwareScrollView);
  expect(scroll.props.children).toBe(body);
  expect(scroll.props.keyboardShouldPersistTaps).toBe("always");
  expect(tree!.root.findAllByType(Text).some(node => node.props.children === "固定操作")).toBe(true);
  expect(scroll.findAllByType(Text).some(node => node.props.children === "固定操作")).toBe(false);
  renderer.act(() => tree!.unmount());
});


beforeEach(() => { mockBottomInset = 0; });

function renderScreen(children: React.ReactNode, props: Partial<React.ComponentProps<typeof Screen>> = {}) {
  let tree: renderer.ReactTestRenderer;
  renderer.act(() => { tree = renderer.create(<Screen {...props}>{children}</Screen>); });
  return tree!;
}

test("enhances scroll views nested through Views, Fragments and arrays without moving fixed siblings", () => {
  const footer = <Text testID="footer">固定操作</Text>;
  const header = <Text testID="header">标题</Text>;
  const tree = renderScreen(
    <View testID="layout" style={{ flex: 1 }}>
      {header}
      <React.Fragment key="body">
        {[null, false, <View key="nested"><ScrollView testID="body"><Text>正文</Text></ScrollView></View>]}
      </React.Fragment>
      {footer}
    </View>,
  );
  const scroll = tree.root.findByType(KeyboardAwareScrollView);
  expect(scroll.props.testID).toBe("body");
  expect(tree.root.findAllByType(KeyboardAwareScrollView)).toHaveLength(1);
  expect(scroll.findAllByProps({ testID: "footer" })).toHaveLength(0);
  expect(scroll.findAllByProps({ testID: "header" })).toHaveLength(0);
  expect(tree.root.findAllByType(View).find(node => node.props.testID === "layout")!.props.style).toEqual({ flex: 1 });
  renderer.act(() => tree.unmount());
});

test.each([
  ["FlatList", FlatList, KeyboardAwareFlatList, { data: [{ key: "one" }], renderItem: () => <Text>条目</Text> }],
  ["SectionList", SectionList, KeyboardAwareSectionList, { sections: [{ data: ["one"] }], renderItem: () => <Text>条目</Text> }],
] as const)("enhances a nested %s and preserves its list props", (_name, NativeList, AwareList, listProps) => {
  const onScroll = jest.fn();
  const tree = renderScreen(<><View>{React.createElement(NativeList as React.ElementType, { ...listProps, onScroll })}</View></>);
  const list = tree.root.findByType(AwareList);
  expect(tree.root.findAllByType(KeyboardAwareScrollView)).toHaveLength(0);
  expect(list.props.onScroll).toBe(onScroll);
  for (const [key, value] of Object.entries(listProps)) expect(list.props[key]).toBe(value);
  renderer.act(() => tree.unmount());
});

test.each([ScrollView, FlatList, SectionList])("leaves horizontal native scrollers unchanged", NativeScroller => {
  const scroller = React.createElement(NativeScroller as React.ElementType, { horizontal: true, data: [], sections: [], renderItem: () => null });
  const tree = renderScreen(<View>{scroller}</View>);
  const outer = tree.root.findByType(KeyboardAwareScrollView);
  expect(outer.props.children.props.children).toBe(scroller);
  expect(tree.root.findAllByType(KeyboardAwareFlatList)).toHaveLength(0);
  expect(tree.root.findAllByType(KeyboardAwareSectionList)).toHaveLength(0);
  renderer.act(() => tree.unmount());
});

test("does not traverse horizontal scroll content, Modal or custom components", () => {
  const Custom = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const nested = <ScrollView testID="opaque-scroll" />;
  for (const opaque of [<Modal key="modal" visible={false}>{nested}</Modal>, <Custom key="custom">{nested}</Custom>, <ScrollView key="horizontal" horizontal>{nested}</ScrollView>]) {
    const tree = renderScreen(<View>{opaque}</View>);
    // An opaque subtree must not suppress the fallback page scroll container.
    expect(tree.root.findByType(KeyboardAwareScrollView).props.children.props.children).toBe(opaque);
    renderer.act(() => tree.update(<Screen><View><ScrollView testID="page" />{opaque}</View></Screen>));
    const scroll = tree.root.findByType(KeyboardAwareScrollView);
    expect(scroll.props.testID).toBe("page");
    const layout = tree.root.findAllByType(View).find(node => Array.isArray(node.props.children) && node.props.children[1] === opaque);
    expect(layout).toBeDefined();
    renderer.act(() => tree.unmount());
  }
});

test.each([KeyboardAwareScrollView, KeyboardAwareFlatList, KeyboardAwareSectionList])("does not wrap existing keyboard-aware containers again", AwareScroller => {
  const child = React.createElement(AwareScroller as React.ElementType, { testID: "existing" }, <ScrollView testID="inner" />);
  const tree = renderScreen(<View>{child}</View>);
  expect(tree.root.findAllByType(AwareScroller)).toHaveLength(1);
  expect(tree.root.findByType(AwareScroller).props.children.props.testID).toBe("inner");
  expect(tree.root.findAllByType(KeyboardAwareScrollView)).toHaveLength(AwareScroller === KeyboardAwareScrollView ? 1 : 0);
  renderer.act(() => tree.unmount());
});

test("preserves nested scroll props, insets and nested style arrays while toggling keyboard padding", () => {
  mockBottomInset = 24;
  const show = jest.fn();
  const listeners = new Map<string, () => void>();
  const listenerSpy = jest.spyOn(Keyboard, "addListener").mockImplementation((event, callback) => {
    listeners.set(event, callback as () => void);
    return { remove: jest.fn() };
  });
  const contentInset = { top: 8, bottom: 9, left: 1, right: 2 };
  const contentStyle = [{ paddingBottom: 10, paddingHorizontal: 6 }, [false, { paddingBottom: 14, flexGrow: 1 }]];
  const tree = renderScreen(<View><ScrollView contentContainerStyle={contentStyle} contentInset={contentInset} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="none" keyboardShouldPersistTaps="always" onScroll={show} scrollEventThrottle={16} /></View>);
  const props = () => tree.root.findByType(KeyboardAwareScrollView).props;
  expect(StyleSheet.flatten(props().contentContainerStyle)).toEqual({ paddingBottom: 38, paddingHorizontal: 6, flexGrow: 1 });
  expect(props().contentInset).toBe(contentInset);
  if (Platform.OS === "ios") expect(props().contentInsetAdjustmentBehavior).toBe("automatic");
  expect(props().keyboardDismissMode).toBe("none");
  expect(props().keyboardShouldPersistTaps).toBe("always");
  expect(props().onScroll).toBe(show);
  expect(props().scrollEventThrottle).toBe(16);
  renderer.act(() => listeners.get(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow")!());
  expect(StyleSheet.flatten(props().contentContainerStyle).paddingBottom).toBe(14);
  renderer.act(() => listeners.get(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide")!());
  expect(StyleSheet.flatten(props().contentContainerStyle).paddingBottom).toBe(38);
  expect(contentStyle[0]).toEqual({ paddingBottom: 10, paddingHorizontal: 6 });
  renderer.act(() => tree.unmount());
  listenerSpy.mockRestore();
});

test("preserves layout refs and exposes native scroller refs, including replacement and cleanup", () => {
  const layoutRef = React.createRef<View>();
  const scrollRef = React.createRef<ScrollView>();
  const replacementRef = jest.fn();
  const cleanup = jest.fn();
  replacementRef.mockReturnValue(cleanup);
  const nativeScroll = { scrollTo: jest.fn() };
  const nativeLayout = {};
  let tree: renderer.ReactTestRenderer;
  const content = (ref: React.Ref<ScrollView>) => <Screen><View ref={layoutRef} testID="layout"><ScrollView ref={ref} testID="scroll" /></View></Screen>;
  renderer.act(() => { tree = renderer.create(content(scrollRef), { createNodeMock: element => element.props.testID === "scroll" ? nativeScroll : nativeLayout }); });
  expect(layoutRef.current).not.toBeNull();
  expect(scrollRef.current).not.toBeNull();
  // The adapter passes refs via innerRef, not to the keyboard-aware HOC itself.
  expect(tree!.root.findByType(KeyboardAwareScrollView).props.ref).toBeUndefined();
  const handle = scrollRef.current;
  renderer.act(() => tree!.update(content(replacementRef)));
  expect(scrollRef.current).toBeNull();
  expect(replacementRef).toHaveBeenCalledWith(handle);
  renderer.act(() => tree!.update(content(replacementRef)));
  expect(replacementRef).toHaveBeenCalledTimes(1);
  expect(cleanup).not.toHaveBeenCalled();
  renderer.act(() => tree!.unmount());
  expect(layoutRef.current).toBeNull();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test("retains keyed scroll and layout identity when sibling order changes", () => {
  const refs = { first: React.createRef<ScrollView>(), second: React.createRef<ScrollView>() };
  const content = (order: (keyof typeof refs)[]) => <Screen>{order.map(key => <View key={key}><React.Fragment key="fragment"><ScrollView key="scroll" ref={refs[key]} testID={key} /></React.Fragment></View>)}</Screen>;
  let tree: renderer.ReactTestRenderer;
  renderer.act(() => { tree = renderer.create(content(["first", "second"])); });
  const original = tree!.root.findAllByType(KeyboardAwareScrollView);
  renderer.act(() => tree!.update(content(["second", "first"])));
  const updated = tree!.root.findAllByType(KeyboardAwareScrollView);
  expect(updated[0]).toBe(original[1]);
  expect(updated[1]).toBe(original[0]);
  renderer.act(() => tree!.unmount());
});

test("the installed keyboard-aware Android HOC preserves padding before and during keyboard display", () => {
  const Actual = jest.requireActual("react-native-keyboard-aware-scroll-view");
  const platform = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
  mockBottomInset = 24;
  const screen = renderScreen(<View><ScrollView contentContainerStyle={[{ paddingBottom: 10 }, [{ paddingBottom: 14, paddingHorizontal: 6 }]]} /></View>);
  const props = screen.root.findByType(KeyboardAwareScrollView).props;
  let actual: renderer.ReactTestRenderer | undefined;
  try {
    renderer.act(() => { actual = renderer.create(<Actual.KeyboardAwareScrollView {...props} innerRef={undefined} />); });
    const nativeStyle = () => StyleSheet.flatten(actual!.root.findByType(ScrollView).props.contentContainerStyle);
    expect(nativeStyle()).toMatchObject({ paddingBottom: 38, paddingHorizontal: 6 });
    renderer.act(() => actual!.root.findByType(Actual.KeyboardAwareScrollView).instance.setState({ keyboardSpace: 120 }));
    expect(nativeStyle()).toMatchObject({ paddingBottom: 158, paddingHorizontal: 6 });
  } finally {
    renderer.act(() => { actual?.unmount(); screen.unmount(); });
    Object.defineProperty(Platform, "OS", { configurable: true, value: platform });
  }
});

test.each(["object", "callback", "cleanup"])("refreshes %s refs when a same-key scroller changes native type", kind => {
  const objectRef = React.createRef<unknown>();
  const cleanup = jest.fn();
  const callbackRef = jest.fn<(() => void) | undefined, [unknown]>(() => kind === "cleanup" ? cleanup : undefined);
  const ref = kind === "object" ? objectRef : callbackRef;
  const content = (type: React.ElementType) => <Screen><View>{React.createElement(type, { key: "same", ref, data: [], sections: [], renderItem: () => null })}</View></Screen>;
  let tree: renderer.ReactTestRenderer;
  renderer.act(() => { tree = renderer.create(content(ScrollView)); });
  const handle = () => kind === "object" ? objectRef.current : callbackRef.mock.calls.at(-1)?.[0];
  let previous = handle();
  expect(previous).not.toBeNull();
  for (const [index, type] of [FlatList, SectionList].entries()) {
    renderer.act(() => tree!.update(content(type)));
    expect(handle()).not.toBeNull();
    expect(handle()).not.toBe(previous);
    if (kind === "cleanup") expect(cleanup).toHaveBeenCalledTimes(index + 1);
    if (kind === "callback") expect(callbackRef.mock.calls.filter(([value]) => value === null)).toHaveLength(index + 1);
    previous = handle();
  }
  renderer.act(() => tree!.unmount());
  if (kind === "object") expect(objectRef.current).toBeNull();
  if (kind === "callback") expect(callbackRef).toHaveBeenLastCalledWith(null);
  if (kind === "cleanup") {
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(callbackRef).toHaveBeenCalledTimes(3);
  }
});


test.each([
  [{ padding: 24 }, 24],
  [{ padding: 24, paddingVertical: 18 }, 18],
  [{ padding: 24, paddingVertical: 18, paddingBottom: 7 }, 7],
  [{ padding: 24, paddingVertical: 18, paddingBottom: 0 }, 0],
])("preserves effective numeric bottom padding from shorthand styles %j", (contentContainerStyle, bottomPadding) => {
  mockBottomInset = 12;
  const tree = renderScreen(<View><ScrollView contentContainerStyle={contentContainerStyle} /></View>);
  expect(tree.root.findByType(KeyboardAwareScrollView).props.contentContainerStyle).toEqual({ ...contentContainerStyle, paddingBottom: bottomPadding + 12 });
  renderer.act(() => tree.unmount());
});
