import React, { useEffect } from 'react';
import {
  Platform,
  StyleSheet,
  ScrollView,
  View,
  Keyboard,
  ViewStyle,
  FlatList,
  SectionList,
} from 'react-native';
import { withUniwind, useCSSVariable, useUniwind } from 'uniwind';
import { useSafeAreaInsets, Edge } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
// 引入 KeyboardAware 系列组件
import {
  KeyboardAwareScrollView,
  KeyboardAwareFlatList,
  KeyboardAwareSectionList
} from 'react-native-keyboard-aware-scroll-view';

/**
 * # Screen 组件使用指南
 *
 * 核心原则：统一使用手动安全区管理 (padding)，支持沉浸式布局，解决 iOS/Android 状态栏一致性问题。
 *
 * ## 1. 普通页面 (默认)
 * - 场景：标准的白底或纯色背景页面，Header 在安全区下方。
 * - 用法：`<Screen>{children}</Screen>`
 * - 行为：自动处理上下左右安全区，状态栏文字黑色。
 *
 * ## 2. 沉浸式 Header (推荐)
 * - 场景：Header 背景色/图片需要延伸到状态栏 (如首页、个人中心)。
 * - 用法：`<Screen safeAreaEdges={['left', 'right', 'bottom']}>` (去掉 'top')
 * - 配合：页面内部 Header 组件必须手动添加 paddingTop:
 *   ```tsx
 *   const insets = useSafeAreaInsets();
 *   <View style={{ paddingTop: insets.top + 12, backgroundColor: '...' }}>
 *   ```
 *
 * ## 3. 底部有 TabBar 或 悬浮按钮
 * - 场景：页面底部有固定导航栏，或者需要精细控制底部留白。
 * - 用法：`<Screen safeAreaEdges={['top', 'left', 'right']}>` (去掉 'bottom')
 * - 配合：
 *   - 若是滚动页：`<ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>`
 *   - 若是固定页：`<View style={{ paddingBottom: insets.bottom + 60 }}>`
 *
 * ## 4. 滚动列表/表单
 * - 场景：长内容，需要键盘避让。
 * - 用法：`<Screen>{children}</Screen>`
 * - 行为：若 View/Fragment 布局中不包含垂直滚动容器，则外层自动使用 ScrollView，
 *        自动处理键盘遮挡，底部安全区会自动加在内容末尾。
 */
interface ScreenProps {
  children: React.ReactNode;
  /** 背景色，默认使用当前主题的 background token */
  backgroundColor?: string;
  /**
   * 状态栏样式
   * - 'auto': 根据当前主题自动选择（默认）
   * - 'light': 白色文字 (深色背景时用)
   */
  statusBarStyle?: 'auto' | 'inverted' | 'light' | 'dark';
  /**
   * 状态栏背景色
   * - 默认 'transparent' 以支持沉浸式
   * - Android 下如果需要不透明，可传入具体颜色
   */
  statusBarColor?: string;
  /**
   * 安全区控制 (关键属性)
   * - 默认: ['top', 'left', 'right', 'bottom'] (全避让)
   * - 沉浸式 Header: 去掉 'top'
   * - 自定义底部: 去掉 'bottom'
   */
  safeAreaEdges?: Edge[];
  /** 自定义容器样式 */
  style?: ViewStyle;
}

type KeyboardAwareProps = {
  element: React.ReactElement<any, any>;
  extraPadding: number;
  contentInsetBehaviorIOS: 'automatic' | 'never';
};

type NativeRefBinding = {
  ref: React.Ref<unknown>;
  instance: unknown;
  cleanup?: () => void;
};

// innerRef is a legacy callback API. Bridge native-handle changes and React 19
// callback cleanup explicitly, including a replacement under the same React key.
const updateNativeRef = (binding: NativeRefBinding, instance: unknown) => {
  if (binding.instance === instance) return;
  if (binding.instance !== null) {
    if (binding.cleanup) binding.cleanup();
    else if (typeof binding.ref === 'function') binding.ref(null);
    else if (binding.ref) binding.ref.current = null;
  }
  binding.cleanup = undefined;
  binding.instance = instance;
  if (instance !== null) {
    if (typeof binding.ref === 'function') {
      const cleanup = binding.ref(instance);
      if (typeof cleanup === 'function') binding.cleanup = cleanup;
    } else if (binding.ref) binding.ref.current = instance;
  }
};

const KeyboardAwareScrollable = ({
  element,
  extraPadding,
  contentInsetBehaviorIOS,
}: KeyboardAwareProps) => {
  // 获取原始组件的 props
  const childAttrs = ((element as React.ReactElement).props ?? {}) as Record<string, unknown>;
  const merged = StyleSheet.flatten(childAttrs['contentContainerStyle'] as ViewStyle) ?? {};
  const bottomPadding = merged.paddingBottom ?? merged.paddingVertical ?? merged.padding;
  const currentPB = typeof bottomPadding === 'number' ? bottomPadding : 0;

  // 合并 paddingBottom (安全区 + 额外留白)
  // The library reads .paddingBottom directly on Android before adding keyboard space.
  const enhancedContentStyle = { ...merged, paddingBottom: currentPB + extraPadding };

  // Preserve the native scroll handle, not the keyboard-aware HOC instance.
  const { ref, ...scrollProps } = childAttrs;
  const nativeRef = React.useRef<unknown>(null);
  const bindingRef = React.useRef<NativeRefBinding | null>(null);
  const setNativeRef = React.useCallback((instance: unknown) => {
    nativeRef.current = instance;
    if (bindingRef.current) updateNativeRef(bindingRef.current, instance);
  }, []);
  React.useLayoutEffect(() => {
    const binding: NativeRefBinding = { ref: ref as React.Ref<unknown>, instance: null };
    bindingRef.current = binding;
    updateNativeRef(binding, nativeRef.current);
    return () => {
      updateNativeRef(binding, null);
      bindingRef.current = null;
    };
  }, [ref]);

  // 基础配置 props，用于传递给 KeyboardAware 组件
  const commonProps = {
    ...scrollProps,
    innerRef: setNativeRef,
    contentContainerStyle: enhancedContentStyle,
    keyboardShouldPersistTaps: childAttrs['keyboardShouldPersistTaps'] ?? 'handled',
    keyboardDismissMode: childAttrs['keyboardDismissMode'] ?? 'on-drag',
    enableOnAndroid: true,
    // 类似于原代码中的 setTimeout/scrollToEnd 逻辑，这里设置额外的滚动高度确保输入框可见
    extraHeight: 100,
    // 禁用自带的 ScrollView 自动 inset，由外部 padding 控制
    enableAutomaticScroll: true,
    ...(Platform.OS === 'ios'
      ? { contentInsetAdjustmentBehavior: childAttrs['contentInsetAdjustmentBehavior'] ?? contentInsetBehaviorIOS }
      : {}),
  };

  const t = (element as React.ReactElement).type;

  // 根据组件类型返回对应的 KeyboardAware 版本
  // 注意：不再使用 KeyboardAvoidingView，直接替换为增强版 ScrollView
  if (t === ScrollView) {
    return <KeyboardAwareScrollView {...(commonProps as any)} />;
  }

  if (t === FlatList) {
    return <KeyboardAwareFlatList {...(commonProps as any)} />;
  }

  if (t === SectionList) {
    return <KeyboardAwareSectionList {...(commonProps as any)} />;
  }

  // 理论上不应运行到这里，如果是非标准组件则原样返回，仅修改样式
  return React.cloneElement(element, {
    contentContainerStyle: enhancedContentStyle,
    keyboardShouldPersistTaps: childAttrs['keyboardShouldPersistTaps'] ?? 'handled',
    keyboardDismissMode: childAttrs['keyboardDismissMode'] ?? 'on-drag',
  });
};

// Detection and replacement share these boundaries. Opaque components (including
// Modal) own their layout; replacing their children can violate their contracts.
const isLayoutContainer = (element: React.ReactElement<any, any>) =>
  element.type === View || element.type === React.Fragment;

const isNativeScrollable = (element: React.ReactElement<any, any>) =>
  element.type === ScrollView || element.type === FlatList || element.type === SectionList;

const hasVerticalScrollable = (nodes: React.ReactNode): boolean => {
  if (Array.isArray(nodes)) return nodes.some(hasVerticalScrollable);
  if (!React.isValidElement(nodes)) return false;
  const element = nodes as React.ReactElement<any, any>;
  const isKeyboardAware = element.type === KeyboardAwareScrollView
    || element.type === KeyboardAwareFlatList || element.type === KeyboardAwareSectionList;
  if (isNativeScrollable(element) || isKeyboardAware) return element.props.horizontal !== true;
  return isLayoutContainer(element) && hasVerticalScrollable(element.props.children);
};

const RawScreen = ({
  children,
  backgroundColor,
  statusBarStyle = 'auto',
  statusBarColor = 'transparent',
  safeAreaEdges = ['top', 'left', 'right', 'bottom'],
  style,
}: ScreenProps) => {
  const insets = useSafeAreaInsets();
  const themeBackground = useCSSVariable('--color-background') as string;
  const { theme } = useUniwind();
  const isFocused = useIsFocused();
  const [keyboardShown, setKeyboardShown] = React.useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvent, () => setKeyboardShown(true));
    const s2 = Keyboard.addListener(hideEvent, () => setKeyboardShown(false));
    return () => { s1.remove(); s2.remove(); };
  }, []);

  const childIsNativeScrollable = hasVerticalScrollable(children);

  // 说明：避免双重补白
  // KeyboardAwareScrollView 内部会自动处理键盘高度。
  // 我们主要关注非键盘状态下的 Safe Area 管理。

  // 解析安全区设置
  const hasTop = safeAreaEdges.includes('top');
  const hasBottom = safeAreaEdges.includes('bottom');
  const hasLeft = safeAreaEdges.includes('left');
  const hasRight = safeAreaEdges.includes('right');

  // 强制禁用 iOS 自动调整内容区域，完全由手动 padding 控制，消除系统自动计算带来的多余空白
  const contentInsetBehaviorIOS = 'never';

  const wrapperStyle: ViewStyle = {
    flex: 1,
    backgroundColor: backgroundColor ?? themeBackground,
    paddingTop: hasTop ? insets.top : 0,
    paddingLeft: hasLeft ? insets.left : 0,
    paddingRight: hasRight ? insets.right : 0,
    // 当页面不使用外层 ScrollView 时（子树本身可滚动），由外层 View 负责底部安全区
    paddingBottom: (childIsNativeScrollable && hasBottom)
      ? (keyboardShown ? 0 : insets.bottom)
      : 0,
  };

  // 若子树不可滚动，则外层使用 KeyboardAwareScrollView 提供“全局页面滑动”能力
  const useScrollContainer = !childIsNativeScrollable;

  // 2. 滚动容器配置
  const containerProps = useScrollContainer ? {
    contentContainerStyle: {
      flexGrow: 1,
      // 滚动模式下，Bottom 安全区由内容容器处理，保证内容能完整显示且不被 Home Indicator 遮挡，同时背景色能延伸到底部
      paddingBottom: hasBottom ? (keyboardShown ? 0 : insets.bottom) : 0,
    },
    keyboardShouldPersistTaps: 'handled' as const,
    showsVerticalScrollIndicator: false,
    keyboardDismissMode: 'on-drag' as const,
    enableOnAndroid: true,
    extraHeight: 100, // 替代原代码手动计算的 offset
    // iOS 顶部白条修复：强制不自动添加顶部安全区
    ...(Platform.OS === 'ios'
      ? { contentInsetAdjustmentBehavior: contentInsetBehaviorIOS }
      : {}),
  } : {};

  // Traverse layout-only ancestors, never custom components, portals or scroll content.
  const wrapScrollableWithKeyboardAvoid = (nodes: React.ReactNode): React.ReactNode => {
    if (Array.isArray(nodes)) return nodes.map(wrapScrollableWithKeyboardAvoid);
    if (!React.isValidElement(nodes)) return nodes;
    const element = nodes as React.ReactElement<any, any>;
    if (isNativeScrollable(element) && element.props.horizontal !== true) {
      return (
        <KeyboardAwareScrollable
          key={element.key}
          element={element}
          extraPadding={keyboardShown ? 0 : (hasBottom ? insets.bottom : 0)}
          contentInsetBehaviorIOS={contentInsetBehaviorIOS}
        />
      );
    }
    if (isLayoutContainer(element)) {
      return React.cloneElement(element, {
        children: wrapScrollableWithKeyboardAvoid(element.props.children),
      });
    }
    return element;
  };

  return (
    // 核心原则：严禁使用 SafeAreaView，统一使用 View + padding 手动管理
    <View
      style={wrapperStyle}
      accessibilityElementsHidden={!isFocused}
      importantForAccessibility={isFocused ? 'auto' : 'no-hide-descendants'}
      aria-hidden={!isFocused}
    >
      {/* 状态栏配置：强制透明背景 + 沉浸式，以支持背景图延伸 */}
      <StatusBar
        style={statusBarStyle === 'auto' ? (theme === 'dark' ? 'light' : 'dark') : statusBarStyle}
        backgroundColor={statusBarColor}
        translucent
      />

      {/* 键盘避让：仅当外层使用 ScrollView 时启用，避免固定底部栏随键盘上移 */}
      {useScrollContainer ? (
         // 替换为 KeyboardAwareScrollView，移除原先的 KeyboardAvoidingView 包裹
         // 因为 KeyboardAwareScrollView 已经内置了处理逻辑
        <KeyboardAwareScrollView style={[styles.innerContainer, style]} {...containerProps}>
          {children}
        </KeyboardAwareScrollView>
      ) : (
        // 页面自身已处理滚动，不启用全局键盘避让，保证固定底部栏不随键盘上移
        <View style={[styles.innerContainer, style]}>
          {wrapScrollableWithKeyboardAvoid(children)}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  innerContainer: {
    flex: 1,
    // 确保内部容器透明，避免背景色遮挡
    backgroundColor: 'transparent',
  },
});

export const Screen = withUniwind(RawScreen);
