import React from "react";
import renderer, { act } from "react-test-renderer";
import { TextInput, TouchableOpacity, Text } from "react-native";
const mockRequest = jest.fn();
const mockLogout = jest.fn(async () => undefined);
const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockUser: {id:number;hasPassword?:boolean;phone_verified_at?:string|null} | null = {id:1};
let mockSearchParams: { recovery?: boolean } = {};
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, logout: mockLogout, sessionGeneration: 4 }), useAuthFetch: () => jest.fn() }));
jest.mock("@/components/AccountSmsVerification",() => ({AccountSmsVerification:() => null}));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ replace: mockReplace, back: jest.fn(), push: mockPush }), useSafeSearchParams: () => mockSearchParams }));
jest.mock("@/services/api/client", () => ({ requestJson: (...args: unknown[]) => mockRequest(...args) }));
import { restoredAuthIdentity } from "@/utils/authIdentity";
import PasswordScreen from "./index";
beforeEach(() => {jest.clearAllMocks();mockUser={id:1};mockSearchParams={};});
test("rejects a multibyte new password above 72 bytes without rejecting a legacy current password", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PasswordScreen />); });
  const inputs = tree.root.findAllByType(TextInput);
  const legacy = "Old1" + "a".repeat(80);
  const tooLong = "Aa1" + "界".repeat(24);
  act(() => {
    inputs[0].props.onChangeText(legacy);
    inputs[1].props.onChangeText(tooLong);
    inputs[2].props.onChangeText(tooLong);
  });
  const submit = () => tree.root.findAllByType(TouchableOpacity).find(item => item.findAllByType(Text).some(text => text.props.children === "修改密码并重新登录"))!.props.onPress();
  await act(async () => { submit(); });
  expect(mockRequest).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("72字节");
  const boundary = "Aa1" + "界".repeat(23);
  act(() => { inputs[1].props.onChangeText(boundary); inputs[2].props.onChangeText(boundary); });
  mockRequest.mockResolvedValueOnce({ success: true });
  await act(async () => { submit(); });
  expect(mockRequest).toHaveBeenCalledWith(expect.anything(), "/api/v1/auth/change-password", {
    method: "POST", body: JSON.stringify({ currentPassword: legacy, newPassword: boundary }),
  });
  act(() => tree.unmount());
});
test("mismatch never sends credentials; successful change revokes the captured session", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PasswordScreen />); });
  const inputs = tree.root.findAllByType(TextInput);
  act(() => { inputs[0].props.onChangeText("OldPassword1"); inputs[1].props.onChangeText("NewPassword2"); inputs[2].props.onChangeText("different"); });
  const submit = () => tree.root.findAllByType(TouchableOpacity).find(item => item.findAllByType(Text).some(text => text.props.children === "修改密码并重新登录"))!.props.onPress();
  await act(async () => { submit(); });
  expect(mockRequest).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("两次输入的新密码不一致");
  act(() => inputs[2].props.onChangeText("NewPassword2"));
  mockRequest.mockRejectedValueOnce(new Error("当前密码不正确"));
  await act(async () => { submit(); });
  expect(mockLogout).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("当前密码不正确");
  mockRequest.mockResolvedValueOnce({ success: true });
  await act(async () => { submit(); });
  expect(mockLogout).toHaveBeenCalledWith("密码已修改，请使用新密码重新登录。", 4);
  expect(mockReplace).toHaveBeenCalledWith("/login");
  act(() => tree.unmount());
});

test("a passwordless account verifies its bound phone and sets its first password without an old password",async () => {
  mockUser=restoredAuthIdentity({id:2,username:"A",hasPassword:false,phone_verified_at:"2026-09-20",phone:"+861234",daily_calories_target:1600});
  let tree!:renderer.ReactTestRenderer;
  await act(async () => {tree=renderer.create(<PasswordScreen />);});
  const inputs=tree.root.findAllByType(TextInput);
  expect(inputs).toHaveLength(2);
  act(() => {inputs[0].props.onChangeText("FirstPassword1");inputs[1].props.onChangeText("FirstPassword1");});
  const submit=() => tree.root.findAllByType(TouchableOpacity).find(item => item.findAllByType(Text).some(text => text.props.children==="修改密码并重新登录"))!.props.onPress();
  await act(async () => {submit();});
  expect(mockRequest).not.toHaveBeenCalled();
  act(() => tree.root.findByProps({purpose:"password_update"}).props.onVerified("verified-phone-token"));
  mockRequest.mockResolvedValueOnce({success:true});
  await act(async () => {submit();});
  expect(mockRequest).toHaveBeenCalledWith(expect.anything(),"/api/v1/auth/password",{method:"POST",body:JSON.stringify({reauthToken:"verified-phone-token",newPassword:"FirstPassword1"})});
  expect(mockLogout).toHaveBeenCalledWith("密码已修改，请使用新密码重新登录。",4);
  act(() => tree.unmount());
});

test("an unauthenticated or recovery request displays recovery guidance and navigates to forgot-password", async () => {
  mockUser = null;
  mockSearchParams = { recovery: true };
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PasswordScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("前往找回密码");
  const forgotButton = tree.root.findAllByType(TouchableOpacity).find(item => item.findAllByType(Text).some(text => text.props.children === "前往找回密码"))!;
  act(() => forgotButton.props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/forgot-password");
  act(() => tree.unmount());
});
