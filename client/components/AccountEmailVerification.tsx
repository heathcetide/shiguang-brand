import { useEffect, useRef, useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useResendCooldown } from "@/hooks/useResendCooldown";
import { requestJson } from "@/services/api/client";

export function AccountEmailVerification() {
  const { user, sessionGeneration } = useAuth();
  return <EmailForm key={`${user?.id}:${sessionGeneration}`} />;
}

function EmailForm() {
  const { user, refreshUser } = useAuth();
  const fetch = useAuthFetch();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  const { countdown, start, isCoolingDown } = useResendCooldown();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!user?.email) return null;

  const submit = async (send: boolean) => {
    if (pending.current || (send && isCoolingDown())) return;
    if (send && !password) return setError("请输入当前密码验证身份");
    if (!send && !/^\d{6}$/.test(code)) return setError("请输入 6 位邮箱验证码");
    pending.current = true; setBusy(true); setError("");
    try {
      if (send) {
        const result = await requestJson<{ challengeId: string; resendAfter: number }>(fetch, "/api/v1/auth/email-verification/send", {
          method: "POST", body: JSON.stringify({ currentPassword: password }),
        });
        if (!active.current) return;
        setChallenge(result.challengeId); start(result.resendAfter); setCode(""); setPassword("");
      } else {
        await requestJson(fetch, "/api/v1/auth/email-verification/verify", { method: "POST", body: JSON.stringify({ challengeId, code }) });
        if (!active.current) return;
        setVerified(true); setCode(""); setPassword(""); setChallenge("");
        await refreshUser();
      }
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : "邮箱验证失败，请重试"); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <View className="gap-3 rounded-xl border border-line p-4">
    <Text className="font-bold text-ink">邮箱找回密码</Text>
    <Text className="text-copy-muted">{user.email}</Text>
    {verified || user.email_verified_at ? <Text className="text-ink">邮箱已验证，可在登录页通过邮箱找回密码。</Text>
      : user.hasPassword === false ? <Text className="text-copy-muted">请先设置登录密码，再验证邮箱。历史注册邮箱不会自动获得恢复权限。</Text> : <>
        <Text className="text-copy-muted">先验证当前密码，再输入邮箱收到的验证码。验证后，此邮箱才能用于找回密码。</Text>
        {!challengeId ? <TextInput accessibilityLabel="邮箱验证当前密码" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy} className="rounded-xl border border-line p-3 text-ink" /> : <>
          <Text className="text-copy-muted">邮件已提交发送，验证码 5 分钟有效。</Text>
          <TextInput accessibilityLabel="邮箱验证验证码" value={code} onChangeText={value => setCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} editable={!busy} className="rounded-xl border border-line p-3 text-ink" />
          <TouchableOpacity accessibilityRole="button" disabled={busy || countdown > 0} onPress={() => { setChallenge(""); setCode(""); setError(""); }}><Text className="text-brand">{countdown > 0 ? `${countdown} 秒后可重新验证` : "重新验证密码并发送"}</Text></TouchableOpacity>
        </>}
        <TouchableOpacity accessibilityRole="button" disabled={busy || (!challengeId && countdown > 0)} onPress={() => void submit(!challengeId)} className="min-h-12 justify-center rounded-xl bg-brand-fill p-3"><Text className="text-center text-white">{busy ? "正在处理…" : challengeId ? "确认验证邮箱" : "发送邮箱验证码"}</Text></TouchableOpacity>
      </>}
    {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
  </View>;
}
