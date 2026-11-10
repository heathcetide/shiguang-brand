import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { requestJson } from "@/services/api/client";
import { AccountSmsVerification } from "@/components/AccountSmsVerification";
import { AccountEmailVerification } from "@/components/AccountEmailVerification";
import { accountPasswordSchema, ACCOUNT_PASSWORD_REQUIREMENTS } from "@dietdigidose/contracts";

export default function PasswordScreen() {
  const { user } = useAuth();
  return <PasswordForm key={user?.id ?? "guest"} />;
}
function PasswordForm() {
  const { user, logout, sessionGeneration } = useAuth();
  const fetch = useAuthFetch();
  const router = useSafeRouter();
  const { recovery } = useSafeSearchParams<{ recovery?: boolean }>();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [reauthToken, setReauthToken] = useState<string | null>(null);
  const [useSms, setUseSms] = useState(user?.hasPassword === false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const submit = async () => {
    if (sending.current) return;
    if (useSms ? !reauthToken : !currentPassword) return setError(useSms ? "请先通过绑定手机验证身份" : "请输入当前密码");
    if (!accountPasswordSchema.safeParse(newPassword).success) return setError(ACCOUNT_PASSWORD_REQUIREMENTS);
    if (newPassword !== confirm) return setError("两次输入的新密码不一致");
    sending.current = true; setBusy(true); setError("");
    try {
      await requestJson(fetch, useSms ? "/api/v1/auth/password" : "/api/v1/auth/change-password", { method: "POST", body: JSON.stringify(useSms ? {reauthToken,newPassword} : { currentPassword, newPassword }) });
      if (!active.current) return;
      setCurrent(""); setNew(""); setConfirm(""); setReauthToken(null);
      await logout("密码已修改，请使用新密码重新登录。", sessionGeneration);
      router.replace("/login");
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : "修改失败，请重试"); }
    finally { sending.current = false; if (active.current) setBusy(false); }
  };
  return <Screen safeAreaEdges={["top", "bottom"]}><ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity>
    <Text className="text-2xl font-bold text-ink">{recovery || !user ? "找回账号" : user.hasPassword === false ? "设置登录密码" : "修改密码"}</Text>
    {recovery || !user ? <View className="gap-4">
      <Text className="text-ink">若账号已绑定并验证手机号，请使用“找回密码”通过短信重设密码，或直接使用短信验证码登录。</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/forgot-password")} className="rounded-xl bg-brand-fill p-4"><Text className="text-center font-bold text-white">前往找回密码</Text></TouchableOpacity>
      <Text className="text-copy-muted">无法使用绑定手机时，请联系向你提供安装包或邀请的管理员申请账号恢复。未验证邮箱不能用于证明账号归属。请提供账号与问题说明，不要发送密码、验证码或健康资料。人工核验完成前不会修改账号。</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/login")}><Text className="text-brand">返回登录</Text></TouchableOpacity>
    </View> : <>
      <Text className="text-copy-muted">修改成功后，所有旧登录会话将失效。{ACCOUNT_PASSWORD_REQUIREMENTS}。</Text>
      {user.hasPassword !== false && !!user.phone_verified_at && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => {setUseSms((value) => !value);setCurrent("");setError("");setReauthToken(null);}}><Text className="text-brand">{useSms ? "使用当前密码验证" : "忘记当前密码？通过手机验证"}</Text></TouchableOpacity>}
      {useSms ? <AccountSmsVerification purpose="password_update" onVerified={setReauthToken} disabled={busy} /> : <TextInput accessibilityLabel="当前密码" placeholder="当前密码" value={currentPassword} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy} className="rounded-xl border border-line bg-surface p-4 text-ink" />}
      {([["新密码", newPassword, setNew], ["确认新密码", confirm, setConfirm]] as const).map(([label, value, onChange]) => <TextInput key={label} accessibilityLabel={label} placeholder={label} value={value} onChangeText={onChange} secureTextEntry autoComplete="new-password" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy} className="rounded-xl border border-line bg-surface p-4 text-ink" />)}
      {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void submit()} className="rounded-xl bg-brand-fill p-4"><Text className="text-white text-center font-bold">{busy ? "正在修改…" : "修改密码并重新登录"}</Text></TouchableOpacity>
      <AccountEmailVerification />
    </>}
  </ScrollView></Screen>;
}
