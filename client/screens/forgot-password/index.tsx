import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Screen } from "@/components/Screen";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useResendCooldown } from "@/hooks/useResendCooldown";
import { authApi } from "@/services/api";
import { accountPasswordSchema, ACCOUNT_PASSWORD_REQUIREMENTS, recoveryEmailSchema } from "@dietdigidose/contracts";

export default function ForgotPasswordScreen() {
  const router = useSafeRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallenge] = useState("");
  const [grant, setGrant] = useState<{ token: string; expiresAt: number } | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const { countdown, start: startCooldown, isCoolingDown } = useResendCooldown();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedTip, setCopiedTip] = useState(false);
  const [complete, setComplete] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const perform = async (action: "send" | "verify" | "reset") => {
    if (pending.current || (action === "send" && isCoolingDown())) return;
    const rawTrimmed = email.trim();
    const normalized = rawTrimmed.toLowerCase();
    if (action === "send" && !recoveryEmailSchema.safeParse(normalized).success) return setError("请输入已验证的邮箱地址");
    if (action === "verify" && !/^\d{6}$/.test(code)) return setError("请输入 6 位验证码");
    if (action === "reset") {
      if (!grant || Date.now() >= grant.expiresAt) { setGrant(null); return setError("身份验证已过期，请重新获取验证码"); }
      if (!accountPasswordSchema.safeParse(password).success) return setError(ACCOUNT_PASSWORD_REQUIREMENTS);
      if (password !== confirmation) return setError("两次输入的新密码不一致");
    }
    pending.current = true; setBusy(true); setError("");
    try {
      if (action === "send") {
        const result = await authApi.sendEmailRecovery(normalized);
        if (!active.current) return;
        setEmail(normalized); setChallenge(result.challengeId); startCooldown(result.resendAfter); setCode(""); setGrant(null);
      } else if (action === "verify") {
        const result = await authApi.verifyEmailRecovery(challengeId, code);
        if (!active.current) return;
        setGrant({ token: result.recoveryToken, expiresAt: Date.now() + result.expiresIn * 1000 }); setCode("");
      } else {
        await authApi.resetPassword(grant!.token, password);
        if (!active.current) return;
        setPassword(""); setConfirmation(""); setGrant(null); setChallenge(""); setComplete(true);
      }
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : "暂时无法完成，请重试"); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const restart = () => { setGrant(null); setChallenge(""); setCode(""); setPassword(""); setConfirmation(""); setError(""); };

  const copyAppealTemplate = async () => {
    const accountIdentifier = email.trim() || "（请填写您的注册邮箱或用户名）";
    const template = `【拾味日常账号人工核验申请】\n申请账号：${accountIdentifier}\n申请类型：密码找回人工核验\n问题说明：无法使用已验证邮箱自助恢复，申请人工核验。\n（注意：本申请不包含且切勿提供密码、验证码或健康隐私）`;
    try {
      await Clipboard.setStringAsync(template);
      if (!active.current) return;
      setError("");
      setCopiedTip(true);
      setTimeout(() => { if (active.current) setCopiedTip(false); }, 3000);
    } catch {
      if (active.current) {
        setCopiedTip(false);
        setError("复制申诉模板失败，请直接长按下方文本手动复制");
      }
    }
  };
  return <Screen safeAreaEdges={["top", "bottom"]}><ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
    <TouchableOpacity accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/login")}><Text className="text-brand">返回</Text></TouchableOpacity>
    <Text accessibilityRole="header" className="text-2xl font-bold text-ink">找回密码</Text>
    {complete ? <>
      <Text className="text-ink">密码已重设，所有旧登录会话已失效。请使用新密码登录。</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/login")} className="rounded-xl bg-brand-fill p-4"><Text className="text-center font-bold text-white">返回登录</Text></TouchableOpacity>
    </> : <>
      <Text className="text-copy-muted">使用账号此前已验证的邮箱恢复。收到验证码不代表已有可恢复账号。重设后所有旧登录会话将失效。</Text>
      {!grant ? <>
        <TextInput accessibilityLabel="已验证邮箱" placeholder="已验证的注册邮箱" value={email} onChangeText={setEmail} editable={!busy && !challengeId} keyboardType="email-address" autoComplete="email" autoCapitalize="none" autoCorrect={false} maxLength={254} className="rounded-xl border border-line bg-surface p-4 text-ink" />
        {challengeId ? <>
          <Text className="text-copy-muted">邮件请求已提交发送，验证码 5 分钟有效；只有此前已验证的邮箱能恢复账号。</Text>
          <TextInput accessibilityLabel="恢复验证码" placeholder="6 位验证码" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} editable={!busy} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} className="rounded-xl border border-line bg-surface p-4 text-ink" />
          <TouchableOpacity accessibilityRole="button" disabled={busy || countdown > 0} onPress={() => void perform("send")}><Text className="text-brand">{countdown > 0 ? `${countdown} 秒后重发` : "重新发送"}</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={restart}><Text className="text-brand">更换邮箱</Text></TouchableOpacity>
        </> : null}
      </> : <>
        <Text className="text-copy-muted">身份已验证，请在 5 分钟内设置新密码。{ACCOUNT_PASSWORD_REQUIREMENTS}。</Text>
        {([["新密码", password, setPassword], ["确认新密码", confirmation, setConfirmation]] as const).map(([label, value, onChangeText]) => <TextInput key={label} accessibilityLabel={label} placeholder={label} value={value} onChangeText={onChangeText} editable={!busy} secureTextEntry autoComplete="new-password" autoCapitalize="none" autoCorrect={false} maxLength={128} className="rounded-xl border border-line bg-surface p-4 text-ink" />)}
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={restart}><Text className="text-brand">重新验证</Text></TouchableOpacity>
      </>}
      {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy, disabled: busy || (!challengeId && countdown > 0) }} disabled={busy || (!challengeId && countdown > 0)} onPress={() => void perform(grant ? "reset" : challengeId ? "verify" : "send")} className="rounded-xl bg-brand-fill p-4"><Text className="text-center font-bold text-white">{busy ? "正在处理…" : grant ? "重设密码" : challengeId ? "验证身份" : countdown > 0 ? `${countdown} 秒后获取` : "获取恢复验证码"}</Text></TouchableOpacity>
    </>}
    <View className="gap-2 rounded-xl border border-line p-4">
      <Text className="font-bold text-ink">无法使用已验证邮箱？</Text>
      <Text selectable className="text-copy-muted">未验证的历史邮箱不能自助恢复。仍能登录时，请在修改密码页验证邮箱；已无法登录且没有可用恢复通道时，请联系向你提供安装包或邀请的管理员，提供账号与问题说明，申请人工核验恢复。不要发送密码、验证码或健康资料。</Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => void copyAppealTemplate()}
        className="mt-1 flex-row items-center justify-center rounded-lg border border-line bg-surface py-2.5 px-3 active:opacity-70"
      >
        <Text className="text-sm font-bold text-brand">{copiedTip ? "已复制申诉模板" : "复制人工申诉说明模板"}</Text>
      </TouchableOpacity>
    </View>
  </ScrollView></Screen>;
}
