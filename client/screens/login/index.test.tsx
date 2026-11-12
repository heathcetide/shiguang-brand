import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
const mockLogin = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockDemoLogin = jest.fn((): { identifier: string; password: string } | null => null);
jest.mock('@/utils/demoLogin', () => ({ getDemoLogin: () => mockDemoLogin() }));
jest.mock('@/hooks/useAuthTransition', () => ({
  useAuthTransition: () => ({ animatedStyle: {}, switching: false, switchScreen: (navigate: () => void) => navigate() }),
}));
jest.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/ThemedFontAwesome6', () => () => null);
// Exercise the product button without mounting HeroUI's native animation providers.
jest.mock('@/heroui/components/button', () => ({
  Button: ({ isDisabled, ...props }: { isDisabled?: boolean; children?: React.ReactNode }) =>
    require('react').createElement(require('react-native').TouchableOpacity, { ...props, disabled: isDisabled }),
}));
jest.mock('uniwind', () => ({ useCSSVariable: () => [] }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ login: mockLogin }) }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ replace: mockReplace, push: mockPush }), useSafeSearchParams: () => ({ returnTo: { pathname: '/inventory' } }) }));
import LoginScreen from './index';
function press(tree: renderer.ReactTestRenderer, title: string) {
  tree.root.findAllByType(TouchableOpacity).find(button => button.findAllByType(Text).some(text => text.props.children === title))!.props.onPress();
}
function input(tree: renderer.ReactTestRenderer, label: string, value: string) {
  tree.root.findAllByType(TextInput).find(field => field.props.accessibilityLabel === label)!.props.onChangeText(value);
}
let tree: renderer.ReactTestRenderer;
beforeEach(async () => {
  jest.clearAllMocks();
  mockLogin.mockReset();
  mockDemoLogin.mockReturnValue(null);
  jest.mocked(AsyncStorage.getItem).mockReset().mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockReset().mockResolvedValue(undefined);
  jest.mocked(AsyncStorage.removeItem).mockReset().mockResolvedValue(undefined);
  await act(async () => { tree = renderer.create(<LoginScreen />); });
});
afterEach(() => { act(() => tree.unmount()); });

test('password login is immediately available and preserves the return destination', async () => {
  expect(tree.root.findAllByType(TextInput)).toHaveLength(2);
  expect(tree.root.findAllByProps({ accessibilityRole: 'tab' })).toHaveLength(0);
  act(() => { input(tree, '邮箱或手机号', 'A@example.com'); input(tree, '密码', 'Example123'); });
  mockLogin.mockResolvedValueOnce({ success: true });
  await act(async () => { press(tree, '登录并继续'); });
  expect(mockLogin).toHaveBeenCalledWith('a@example.com', 'Example123');
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/inventory' });
});

test('existing phone-and-password accounts retain password login', async () => {
  act(() => { input(tree, '邮箱或手机号', '13800138000'); input(tree, '密码', 'Existing123'); });
  mockLogin.mockResolvedValueOnce({ success: true });
  await act(async () => { press(tree, '登录并继续'); });
  expect(mockLogin).toHaveBeenCalledWith('13800138000', 'Existing123');
});

test('invalid identifiers never send credentials and failures do not navigate', async () => {
  act(() => { input(tree, '邮箱或手机号', 'invalid'); input(tree, '密码', 'Example123'); });
  await act(async () => { press(tree, '登录并继续'); });
  expect(mockLogin).not.toHaveBeenCalled();
  act(() => input(tree, '邮箱或手机号', 'a@example.test'));
  mockLogin.mockResolvedValueOnce({ success: false, error: '账号或密码错误' });
  await act(async () => { press(tree, '登录并继续'); });
  expect(JSON.stringify(tree.toJSON())).toContain('账号或密码错误');
  expect(mockReplace).not.toHaveBeenCalled();
  expect(tree.root.findByProps({ accessibilityLabel: '密码' }).props.value).toBe('');
});

test('remember-account and recovery controls share a separate row outside the inputs', async () => {
  const remember = tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityRole === 'checkbox')!;
  const recovery = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === '忘记密码？'))!;
  expect(remember.parent).toBe(recovery.parent);
  expect(remember.parent!.findAllByType(TextInput)).toHaveLength(0);
  expect(remember.props.className).toContain('min-h-11');
  expect(recovery.props.className).toContain('min-h-11');
  expect(remember.props.accessibilityLabel).toBe('记住');
  expect(remember.props.accessibilityHint).toContain('不保存密码');
  expect(remember.props.accessibilityState.checked).toBe(true);
  expect(remember.props['aria-checked']).toBe(true);
  await act(async () => remember.props.onPress());
  expect(remember.props.accessibilityState.checked).toBe(false);
  expect(remember.props['aria-checked']).toBe(false);
  await act(async () => remember.props.onPress());
  expect(remember.props.accessibilityState.checked).toBe(true);
});

test('remember saves a successful account only, and opting out clears it without another login', async () => {
  act(() => { input(tree, '邮箱或手机号', 'A@example.com'); input(tree, '密码', 'Example123'); });
  mockLogin.mockResolvedValue({ success: true });
  await act(async () => { press(tree, '登录并继续'); });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('@remembered_login_identifier', 'a@example.com');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('@remember_login_identifier', 'true');
  expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(expect.anything(), 'Example123');
  await act(async () => {
    tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityRole === 'checkbox')!.props.onPress();
  });
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@remembered_login_identifier');
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('@remember_login_identifier', 'false');
  expect(mockLogin).toHaveBeenCalledTimes(1);
});

test('failed login does not remember an unverified identifier', async () => {
  act(() => { input(tree, '邮箱或手机号', 'a@example.test'); input(tree, '密码', 'Example123'); });
  mockLogin.mockResolvedValueOnce({ success: false, error: '账号或密码错误' });
  await act(async () => { press(tree, '登录并继续'); });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('password visibility can be toggled without changing its value', () => {
  act(() => input(tree, '密码', 'Example123'));
  act(() => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === '显示密码')!.props.onPress());
  const password = tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === '密码')!;
  expect(password.props.secureTextEntry).toBe(false);
  expect(password.props.value).toBe('Example123');
  act(() => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === '隐藏密码')!.props.onPress());
  expect(password.props.secureTextEntry).toBe(true);
  expect(mockLogin).not.toHaveBeenCalled();
});

test('primary and registration actions keep accessible labels and consistent touch heights', () => {
  const buttons = tree.root.findAllByType(TouchableOpacity);
  const primary = buttons.find(node => node.props.accessibilityLabel === '登录并继续')!;
  const register = buttons.find(node => node.props.accessibilityLabel === '创建账号')!;
  expect(primary.props.disabled).toBe(true);
  expect(primary.props.className).toContain('bg-[#164B35]');
  expect(primary.props.className).toContain('h-11');
  expect(register.props.className).toContain('h-11');
  expect(primary.findAllByType(Text).find(node => node.props.children === '登录并继续')!.props.className).toContain('text-[15px]');
  expect(register.findAllByType(Text).find(node => node.props.children === '创建账号')).toBeDefined();
});

test('configured local demo only prefills the inputs, keeping the password masked without a credential hint', async () => {
  act(() => tree.unmount());
  mockDemoLogin.mockReturnValue({ identifier: 'demo@example.test', password: 'DisposableDemo123' });
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  await act(async () => { tree = renderer.create(<LoginScreen />); });
  expect(tree.root.findAllByType(TextInput).map(node => node.props.value)).toEqual(['demo@example.test', 'DisposableDemo123']);
  const visibleText = tree.root.findAllByType(Text).map(node => node.props.children).flat().join('');
  expect(visibleText).not.toContain('本地测试账号');
  expect(visibleText).not.toContain('demo@example.test');
  expect(visibleText).not.toContain('DisposableDemo123');
  expect(visibleText).not.toContain('仅限隔离测试数据');
  expect(tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === '密码')!.props.secureTextEntry).toBe(true);
  expect(mockLogin).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('no demo credential hint is displayed without explicit configuration', () => {
  expect(JSON.stringify(tree.toJSON())).not.toContain('本地测试账号');
  expect(tree.root.findAllByType(TextInput).map(node => node.props.value)).toEqual(['', '']);
});

test('a saved account is restored instead of pairing it with a different demo password', async () => {
  act(() => tree.unmount());
  mockDemoLogin.mockReturnValue({ identifier: 'demo@example.test', password: 'DisposableDemo123' });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key === '@remembered_login_identifier' ? 'remembered@example.test' : 'true');
  await act(async () => { tree = renderer.create(<LoginScreen />); });
  expect(tree.root.findAllByType(TextInput).map(node => node.props.value)).toEqual(['remembered@example.test', '']);
  expect(tree.root.findByProps({ accessibilityRole: 'checkbox' }).props.accessibilityState.checked).toBe(true);
});

test('opting out persists across remounts and suppresses automatic demo prefilling', async () => {
  act(() => tree.unmount());
  const stored = new Map<string, string>([['@remembered_login_identifier', 'saved@example.test']]);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { stored.set(key, value); });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { stored.delete(key); });
  mockDemoLogin.mockReturnValue({ identifier: 'demo@example.test', password: 'DisposableDemo123' });
  await act(async () => { tree = renderer.create(<LoginScreen />); });
  await act(async () => { press(tree, '记住'); });
  expect(stored.has('@remembered_login_identifier')).toBe(false);
  expect(stored.get('@remember_login_identifier')).toBe('false');
  act(() => tree.unmount());
  await act(async () => { tree = renderer.create(<LoginScreen />); });
  expect(tree.root.findByProps({ accessibilityRole: 'checkbox' }).props.accessibilityState.checked).toBe(false);
  expect(tree.root.findAllByType(TextInput).map(node => node.props.value)).toEqual(['', '']);
  expect(JSON.stringify(tree.toJSON())).not.toContain('本地测试账号');
});

test('slow storage cannot overwrite an account and password being typed', async () => {
  act(() => tree.unmount());
  let resolveAccount!: (value: string | null) => void;
  let resolvePreference!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementation(key => new Promise(resolve => {
    if (key === '@remembered_login_identifier') resolveAccount = resolve;
    else resolvePreference = resolve;
  }));
  act(() => { tree = renderer.create(<LoginScreen />); });
  act(() => { input(tree, '邮箱或手机号', 'typed@example.test'); input(tree, '密码', 'Typed123'); });
  await act(async () => { resolveAccount('old@example.test'); resolvePreference('true'); });
  expect(tree.root.findAllByType(TextInput).map(node => node.props.value)).toEqual(['typed@example.test', 'Typed123']);
});

test('a checkbox click made before storage loads takes precedence over stored values', async () => {
  act(() => tree.unmount());
  let resolveAccount!: (value: string | null) => void;
  let resolvePreference!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementation(key => new Promise(resolve => {
    if (key === '@remembered_login_identifier') resolveAccount = resolve;
    else resolvePreference = resolve;
  }));
  act(() => { tree = renderer.create(<LoginScreen />); });
  await act(async () => { press(tree, '记住'); });
  await act(async () => { resolveAccount('old@example.test'); resolvePreference('true'); });
  expect(tree.root.findByProps({ accessibilityRole: 'checkbox' }).props.accessibilityState.checked).toBe(false);
  expect(tree.root.findAllByType(TextInput).map(node => node.props.value)).toEqual(['', '']);
});

test('rapid checkbox toggles preserve the final preference in storage', async () => {
  act(() => { press(tree, '记住'); });
  act(() => { press(tree, '记住'); });
  await act(async () => { press(tree, '记住'); });
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('@remember_login_identifier', 'false');
  expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(2);
  expect(tree.root.findByProps({ accessibilityRole: 'checkbox' }).props.accessibilityState.checked).toBe(false);
});

test('registration and recovery remain reachable', () => {
  act(() => { press(tree, '忘记密码？'); });
  expect(mockPush).toHaveBeenCalledWith('/forgot-password');
  act(() => { press(tree, '创建账号'); });
  expect(mockPush).toHaveBeenCalledWith('/register', { returnTo: { pathname: '/inventory' } });
});
