import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
const mockSend = jest.fn();
const mockVerify = jest.fn();
const mockLogin = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/ThemedFontAwesome6', () => () => null);
jest.mock('uniwind', () => ({ useCSSVariable: () => [] }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ login: mockLogin, sendSmsCode: mockSend, verifySmsCode: mockVerify }) }));
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
  jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(100000);
  await act(async () => { tree = renderer.create(<LoginScreen />); });
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); });

test('successful sends alone start the server cooldown; synchronous repeats and stale handlers cannot resend early', async () => {
  act(() => input(tree, '手机号', '+86 13800138000'));
  mockSend.mockResolvedValueOnce({ success: false, error: 'failed' });
  await act(async () => { press(tree, '获取验证码'); });
  expect(JSON.stringify(tree.toJSON())).toContain('failed');
  let resolve!: (value: unknown) => void;
  mockSend.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => { press(tree, '获取验证码'); press(tree, '获取验证码'); });
  expect(mockSend).toHaveBeenCalledTimes(2);
  await act(async () => { resolve({ success: true, challengeId: 'sms', resendAfter: 45 }); });
  expect(mockSend).toHaveBeenLastCalledWith('13800138000');
  await act(async () => { press(tree, '45s'); });
  expect(mockSend).toHaveBeenCalledTimes(2);
  act(() => input(tree, '短信验证码', '123456'));
  jest.setSystemTime(150000);
  act(() => jest.advanceTimersByTime(1000));
  mockSend.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { press(tree, '重新发送'); });
  expect(JSON.stringify(tree.toJSON())).toContain('重新发送');
  mockSend.mockResolvedValueOnce({ success: true, challengeId: 'retry' });
  await act(async () => { press(tree, '重新发送'); });
  expect(JSON.stringify(tree.toJSON())).toContain('60s');
  // Login intentionally clears cooldown when changing the phone (recovery does not).
  act(() => press(tree, '更换'));
  mockSend.mockResolvedValueOnce({ success: true, challengeId: 'new', resendAfter: 30 });
  await act(async () => { press(tree, '获取验证码'); });
  expect(JSON.stringify(tree.toJSON())).toContain('30s');
});

test('SMS verification and password login preserve their existing return destination', async () => {
  act(() => input(tree, '手机号', '13800138000'));
  mockSend.mockResolvedValueOnce({ success: true, challengeId: 'sms', resendAfter: 60 });
  await act(async () => { press(tree, '获取验证码'); });
  act(() => input(tree, '短信验证码', '123456'));
  mockVerify.mockResolvedValueOnce({ success: true });
  await act(async () => { press(tree, '验证并继续'); });
  expect(mockVerify).toHaveBeenCalledWith('sms', '123456');
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/inventory' });
  act(() => { press(tree, '密码登录'); });
  act(() => { input(tree, '邮箱或手机号', 'A@example.com'); input(tree, '密码', 'Example123'); });
  mockLogin.mockResolvedValueOnce({ success: true });
  await act(async () => { press(tree, '登录并继续'); });
  expect(mockLogin).toHaveBeenCalledWith('a@example.com', 'Example123');
  expect(mockReplace).toHaveBeenLastCalledWith({ pathname: '/inventory' });
});

test('send completion after unmount cannot start a cooldown timer', async () => {
  let resolve!: (value: unknown) => void;
  mockSend.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => input(tree, '手机号', '13800138000'));
  act(() => press(tree, '获取验证码'));
  act(() => tree.unmount());
  const interval = jest.spyOn(globalThis, 'setInterval');
  await act(async () => { resolve({ success: true, challengeId: 'late', resendAfter: 60 }); });
  expect(interval).not.toHaveBeenCalled();
  interval.mockRestore();
});


test('a saved phone-change callback cannot reset an in-flight resend, including rejection', async () => {
  act(() => input(tree, '手机号', '13800138000'));
  mockSend.mockResolvedValueOnce({ success: true, challengeId: 'first', resendAfter: 1 });
  await act(async () => { press(tree, '获取验证码'); });
  const changePhone = tree.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(text => text.props.children === '更换'))!.props.onPress;
  act(() => jest.advanceTimersByTime(1000));
  let resolve!: (value: unknown) => void;
  mockSend.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => { press(tree, '重新发送'); changePhone(); });
  expect(tree.root.findAllByType(TextInput).some(field => field.props.accessibilityLabel === '短信验证码')).toBe(true);
  expect(tree.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(text => text.props.children === '更换'))!.props.disabled).toBe(true);
  await act(async () => { resolve({ success: true, challengeId: 'second', resendAfter: 1 }); });
  act(() => input(tree, '短信验证码', '123456'));
  mockVerify.mockResolvedValueOnce({ success: false, error: 'invalid' });
  await act(async () => { press(tree, '验证并继续'); });
  expect(mockVerify).toHaveBeenLastCalledWith('second', '123456');
  act(() => jest.advanceTimersByTime(1000));
  let reject!: (error: Error) => void;
  mockSend.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
  act(() => { press(tree, '重新发送'); changePhone(); });
  await act(async () => { reject(new Error('resend failed')); });
  expect(JSON.stringify(tree.toJSON())).toContain('resend failed');
  expect(JSON.stringify(tree.toJSON())).toContain('重新发送');
  act(() => press(tree, '更换'));
  expect(tree.root.findAllByType(TextInput).some(field => field.props.accessibilityLabel === '短信验证码')).toBe(false);
  act(() => input(tree, '手机号', '13900139000'));
  mockSend.mockResolvedValueOnce({ success: true, challengeId: 'new-phone', resendAfter: 60 });
  await act(async () => { press(tree, '获取验证码'); });
  expect(mockSend).toHaveBeenLastCalledWith('13900139000');
});

test('a saved pre-render send callback cannot bypass the deadline after completion', async () => {
  act(() => input(tree, '手机号', '13800138000'));
  const send = tree.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(text => text.props.children === '获取验证码'))!.props.onPress;
  mockSend.mockResolvedValueOnce({ success: true, challengeId: 'first', resendAfter: 60 });
  await act(async () => { send(); });
  await act(async () => { send(); });
  expect(mockSend).toHaveBeenCalledTimes(1);
});
