import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
const mockRequest = jest.fn();
const mockRefresh = jest.fn(async () => true);
let mockGeneration = 1;
let mockUser = { id: 1, email: "one@example.com", email_verified_at: null as string | null, hasPassword: true };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, sessionGeneration: mockGeneration, refreshUser: mockRefresh }), useAuthFetch: () => jest.fn() }));
jest.mock("@/services/api/client", () => ({ requestJson: (...args: unknown[]) => mockRequest(...args) }));
import { AccountEmailVerification } from "./AccountEmailVerification";
function press(tree: renderer.ReactTestRenderer, label: string) {
  tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!.props.onPress();
}
function input(tree: renderer.ReactTestRenderer, label: string, value: string) {
  tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!.props.onChangeText(value);
}
beforeEach(() => { jest.clearAllMocks(); mockGeneration = 1; mockUser = { id: 1, email: "one@example.com", email_verified_at: null, hasPassword: true }; });
test("email ownership needs a password and code, clears credentials and refreshes identity", async () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<AccountEmailVerification />); });
  await act(async () => { press(tree,"发送邮箱验证码"); });
  expect(mockRequest).not.toHaveBeenCalled();
  act(() => input(tree,"邮箱验证当前密码","OldPass123"));
  mockRequest.mockResolvedValueOnce({challengeId:"email-proof",resendAfter:60});
  await act(async () => { press(tree,"发送邮箱验证码"); });
  expect(mockRequest).toHaveBeenCalledWith(expect.anything(),"/api/v1/auth/email-verification/send",{method:"POST",body:JSON.stringify({currentPassword:"OldPass123"})});
  expect(JSON.stringify(tree.toJSON())).not.toContain("OldPass123");
  await act(async () => { press(tree,"确认验证邮箱"); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  act(() => input(tree,"邮箱验证验证码","123456"));
  mockRequest.mockResolvedValueOnce({success:true});
  await act(async () => { press(tree,"确认验证邮箱"); });
  expect(mockRequest).toHaveBeenLastCalledWith(expect.anything(),"/api/v1/auth/email-verification/verify",{method:"POST",body:JSON.stringify({challengeId:"email-proof",code:"123456"})});
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("邮箱已验证");
  act(() => tree.unmount());
});
test("a late delivery response cannot populate another session and duplicate sends are blocked", async () => {
  let done!: (result: unknown) => void;
  mockRequest.mockReturnValueOnce(new Promise(resolve => {done=resolve;}));
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree=renderer.create(<AccountEmailVerification />);});
  act(() => input(tree,"邮箱验证当前密码","OldPass123"));
  act(() => {press(tree,"发送邮箱验证码");press(tree,"发送邮箱验证码");});
  expect(mockRequest).toHaveBeenCalledTimes(1);
  mockGeneration=2;
  act(() => tree.update(<AccountEmailVerification />));
  await act(async () => {done({challengeId:"old-session",resendAfter:60});});
  expect(JSON.stringify(tree.toJSON())).not.toContain("邮件已提交发送");
  expect(tree.root.findByType(TextInput).props.value).toBe("");
  act(() => tree.unmount());
});
test("SMTP failures remain retryable and passwordless accounts are guided to set a password", async () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {tree=renderer.create(<AccountEmailVerification />);});
  act(() => input(tree,"邮箱验证当前密码","OldPass123"));
  mockRequest.mockRejectedValueOnce(new Error("邮箱验证服务尚未配置"));
  await act(async () => {press(tree,"发送邮箱验证码");});
  expect(JSON.stringify(tree.toJSON())).toContain("邮箱验证服务尚未配置");
  expect(mockRefresh).not.toHaveBeenCalled();
  mockUser={...mockUser,hasPassword:false};
  act(() => tree.update(<AccountEmailVerification />));
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("请先设置登录密码");
  act(() => tree.unmount());
});
