import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
const mockLogin = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
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

test('registration and recovery remain reachable', () => {
  act(() => { press(tree, '忘记密码？'); });
  expect(mockPush).toHaveBeenCalledWith('/forgot-password');
  act(() => { press(tree, '创建账号'); });
  expect(mockPush).toHaveBeenCalledWith('/register', { returnTo: { pathname: '/inventory' } });
});
