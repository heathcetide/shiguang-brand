import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { phoneBindingSendSchema, phoneReplacementSendSchema } from "@dietdigidose/contracts";
import { z } from "zod";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { ApiError, requestJson } from "@/services/api/client";

const sentSchema = z.object({ challengeId: z.string().uuid(), phoneMasked: z.string().min(1),
  expiresIn: z.number().positive().finite(), resendAfter: z.number().nonnegative().finite() });
const boundSchema = z.object({ success: z.literal(true), phoneMasked: z.string().min(1) });
const invalidChallenges = new Set(["SMS_CODE_EXPIRED", "SMS_CHALLENGE_NOT_ACTIVE", "SMS_CHALLENGE_NOT_FOUND",
  "SMS_VERIFY_LIMITED", "PHONE_BINDING_INVALID", "REAUTH_REQUIRED", "PHONE_EXISTS"]);

// Never show an unrecognized legacy phone value verbatim.
function maskedPhone(phone: string) {
  const digits = phone.replace(/^\+86/, "");
  return /^1[3-9]\d{9}$/.test(digits) ? `+86 ${digits.slice(0, 3)}****${digits.slice(-4)}` : "已记录手机号";
}

export function PhoneBindingSettings() {
  const { user, refreshUser, sessionGeneration, isSessionCurrent } = useAuth();
  const [open, setOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [bound, setBound] = useState("");
  const [checking, setChecking] = useState(false);
  const [readError, setReadError] = useState("");
  const opening = useRef(false);
  const focused = useRef(false);
  const openRequest = useRef(0);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void refreshUser();
    return () => { focused.current = false; openRequest.current++; opening.current = false; setChecking(false); setOpen(false); setReplaceOpen(false); };
  }, [refreshUser]));
  const openForm = async (mode: "bind" | "replace") => {
    if (!user || opening.current) return;
    const request = ++openRequest.current;
    opening.current = true; setChecking(true); setReadError("");
    const updated = await refreshUser();
    if (request === openRequest.current && focused.current && isSessionCurrent(user.id, sessionGeneration)) {
      if (mode === "bind") setOpen(updated);
      else setReplaceOpen(updated);
      if (!updated) setReadError("暂时无法确认手机号状态，请联网后重试。");
      setChecking(false);
    }
    if (request === openRequest.current) opening.current = false;
  };
  if (!user) return null;
  const hasBoundPhone = !!bound || (!!user.phone && !!user.phone_verified_at);
  const eligible = user.phone === null && !bound && !!user.email && user.hasPassword === true && user.role === "user";
  const eligibleReplace = hasBoundPhone && user.hasPassword === true && user.role === "user";
  const summary = bound ? `${bound} · 已验证` : user.phone ? `${maskedPhone(user.phone)} · ${user.phone_verified_at ? "已验证" : "未验证"}`
    : user.phone === undefined ? "联网后查看手机号状态" : "尚未绑定手机号";
  return <View className="mb-4 gap-3 rounded-2xl border border-line bg-surface p-4">
    <Text className="font-bold text-ink">手机号</Text>
    <Text className="text-sm text-copy-muted">{summary}</Text>
    {eligible ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="首次绑定手机号" disabled={checking} onPress={() => void openForm("bind")}>
      <Text className="font-bold text-brand">{checking ? "正在确认账号状态…" : "首次绑定手机号"}</Text>
    </TouchableOpacity> : !user.phone && !bound ? <Text className="text-sm text-copy-muted">首次绑定仅支持有登录密码的普通邮箱账号，请联网确认账号状态。</Text> : null}
    {eligibleReplace ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="更换手机号" disabled={checking} onPress={() => void openForm("replace")}>
      <Text className="font-bold text-brand">{checking ? "正在确认账号状态…" : "更换手机号"}</Text>
    </TouchableOpacity> : null}
    {!!readError && <Text accessibilityRole="alert" className="text-critical">{readError}</Text>}
    {open && (eligible || !!bound) && <PhoneBindingForm onClose={() => setOpen(false)} onBound={setBound} />}
    {replaceOpen && eligibleReplace && <PhoneReplacementForm onClose={() => setReplaceOpen(false)} onBound={setBound} />}
  </View>;
}

function PhoneBindingForm({ onClose, onBound }: { onClose: () => void; onBound: (phone: string) => void }) {
  const { user, sessionGeneration, isSessionCurrent, refreshUser } = useAuth();
  const authFetch = useAuthFetch();
  // A reopened form must not join an aborted mutation from its previous instance.
  const fetch = useCallback((input: string, init?: RequestInit) => authFetch(input, init), [authFetch]);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<z.infer<typeof sentSchema> | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const current = () => active.current && !!user && isSessionCurrent(user.id, sessionGeneration);
  const stop = useCallback(() => { active.current = false; controller.current?.abort(); }, []);
  useFocusEffect(useCallback(() => { active.current = true; return stop; }, [stop]));
  useEffect(() => stop, [stop]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const close = () => { stop(); setPassword(""); setCode(""); onClose(); };
  const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const expired = !!challenge && now >= expiresAt;
  const begin = () => {
    if (pending.current || !current()) return false;
    pending.current = true; setBusy(true); setError("");
    controller.current = new AbortController();
    return true;
  };
  const finish = () => { if (current()) { pending.current = false; setBusy(false); } };
  const send = async () => {
    if (Date.now() < retryAt || success) return;
    const input = phoneBindingSendSchema.safeParse({ phone: phone.trim(), currentPassword: password });
    if (!input.success) { setError("请输入当前密码和有效的中国大陆手机号（+86）"); return; }
    if (!begin()) return;
    setPassword(""); setCode(""); setChallenge(null);
    try {
      const result = await requestJson(fetch, "/api/v1/auth/phone-binding/send", {
        method: "POST", body: JSON.stringify(input.data), signal: controller.current!.signal,
      }, sentSchema);
      if (!current()) return;
      const receivedAt = Date.now();
      setChallenge(result); setPhone(input.data.phone); setNow(receivedAt);
      setRetryAt(receivedAt + result.resendAfter * 1000); setExpiresAt(receivedAt + result.expiresIn * 1000);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : "发送失败，请稍后重试");
    } finally { finish(); }
  };
  const refresh = async () => {
    const updated = await refreshUser();
    if (current()) {
      setRefreshed(updated);
      if (!updated) setError("手机号已绑定，但账号状态刷新失败，请联网后重试刷新。");
    }
  };
  const verify = async () => {
    if (!challenge || success || Date.now() >= expiresAt || !/^\d{6}$/.test(code) || !begin()) return;
    const submittedCode = code; setCode("");
    try {
      const result = await requestJson(fetch, "/api/v1/auth/phone-binding/verify", {
        method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, code: submittedCode }), signal: controller.current!.signal,
      }, boundSchema);
      if (!current()) return;
      setSuccess(true); setChallenge(null); setPassword(""); setPhone(""); onBound(result.phoneMasked);
      await refresh();
    } catch (reason) {
      if (!current()) return;
      if (reason instanceof ApiError && invalidChallenges.has(reason.code || "")) setChallenge(null);
      setError(reason instanceof Error ? reason.message : "绑定结果尚未确认，请联网后查看账号状态再重试");
    } finally { finish(); }
  };
  return <Modal visible transparent animationType="slide" onRequestClose={close}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end bg-black/40">
    <View className="max-h-[90%] rounded-t-3xl border-t border-line bg-surface p-6">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}>
        <Text accessibilityRole="header" className="text-xl font-bold text-ink">首次绑定手机号</Text>
        {success ? <>
          <Text className="text-ink">手机号已绑定并验证。后续可用短信登录原账号，库存、饮食记录和偏好保留。</Text>
          {refreshed ? <Text className="text-brand">账号状态已刷新</Text> : <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={async () => { if (!begin()) return; try { await refresh(); } finally { finish(); } }}><Text className="text-brand">重新刷新账号状态</Text></TouchableOpacity>}
        </> : <>
          <Text className="text-sm leading-5 text-copy-muted">先验证当前登录密码，再验证目标手机。仅支持中国大陆 +86 手机号，绑定到当前账号。</Text>
          <TextInput accessibilityLabel="绑定手机号" placeholder="中国大陆手机号（+86）" value={phone} onChangeText={setPhone}
            editable={!busy && !challenge} keyboardType="phone-pad" autoComplete="off" autoCorrect={false} maxLength={14} className="rounded-xl border border-line p-4 text-ink" />
          {!!challenge && <>
            <Text className="text-copy-muted">短信服务已受理发送至 {challenge.phoneMasked} 的请求；实际送达以手机收码为准。</Text>
            <Text className="text-copy-muted">{expired ? "验证码已过期，请重新获取" : "验证码 5 分钟内有效"}</Text>
            <TextInput accessibilityLabel="绑定验证码" placeholder="6 位验证码" value={code} onChangeText={value => setCode(value.replace(/\D/g, "").slice(0, 6))}
              editable={!busy && !expired} keyboardType="number-pad" maxLength={6} autoComplete="off" autoCorrect={false} className="rounded-xl border border-line p-4 text-ink" />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="确认绑定" disabled={busy || expired || code.length !== 6} onPress={() => void verify()} className="rounded-xl bg-brand-fill p-4"><Text className="text-center font-bold text-white">{busy ? "处理中…" : "确认绑定"}</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { setChallenge(null); setCode(""); setPassword(""); setError(""); }}><Text className="text-brand">返回修改手机号</Text></TouchableOpacity>
          </>}
          <TextInput accessibilityLabel="绑定当前密码" placeholder={challenge ? "重新发送需再次输入当前密码" : "当前登录密码"} value={password} onChangeText={setPassword}
            secureTextEntry autoComplete="off" textContentType="none" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy} className="rounded-xl border border-line p-4 text-ink" />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="发送绑定验证码" disabled={busy || cooldown > 0 || !password} onPress={() => void send()} className="rounded-xl bg-background-secondary p-4"><Text className="text-center text-brand">{cooldown > 0 ? `${cooldown} 秒后可重发` : busy ? "处理中…" : "发送验证码"}</Text></TouchableOpacity>
        </>}
        {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭手机号绑定" onPress={close} className="p-3"><Text className="text-center text-copy-muted">{success ? "完成" : "取消"}</Text></TouchableOpacity>
        {!success && <Text className="text-xs text-copy-muted">提交后关闭页面不会撤销服务端已完成的绑定；再次打开前会重新读取账号状态。</Text>}
      </ScrollView>
    </View>
  </KeyboardAvoidingView></Modal>;
}

function PhoneReplacementForm({ onClose, onBound }: { onClose: () => void; onBound: (phone: string) => void }) {
  const { user, sessionGeneration, isSessionCurrent, refreshUser } = useAuth();
  const authFetch = useAuthFetch();
  // A reopened form must not join an aborted mutation from its previous instance.
  const fetch = useCallback((input: string, init?: RequestInit) => authFetch(input, init), [authFetch]);
  const [newPhone, setNewPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<z.infer<typeof sentSchema> | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const current = () => active.current && !!user && isSessionCurrent(user.id, sessionGeneration);
  const stop = useCallback(() => { active.current = false; controller.current?.abort(); }, []);
  useFocusEffect(useCallback(() => { active.current = true; return stop; }, [stop]));
  useEffect(() => stop, [stop]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const close = () => { stop(); setPassword(""); setCode(""); onClose(); };
  const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const expired = !!challenge && now >= expiresAt;
  const begin = () => {
    if (pending.current || !current()) return false;
    pending.current = true; setBusy(true); setError("");
    controller.current = new AbortController();
    return true;
  };
  const finish = () => { if (current()) { pending.current = false; setBusy(false); } };
  const send = async () => {
    if (Date.now() < retryAt || success) return;
    const input = phoneReplacementSendSchema.safeParse({ newPhone: newPhone.trim(), currentPassword: password });
    if (!input.success) { setError("请输入当前密码和有效的新中国大陆手机号（+86）"); return; }
    if (!begin()) return;
    setPassword(""); setCode(""); setChallenge(null);
    try {
      const result = await requestJson(fetch, "/api/v1/auth/phone-binding/replace/send", {
        method: "POST", body: JSON.stringify(input.data), signal: controller.current!.signal,
      }, sentSchema);
      if (!current()) return;
      const receivedAt = Date.now();
      setChallenge(result); setNewPhone(input.data.newPhone); setNow(receivedAt);
      setRetryAt(receivedAt + result.resendAfter * 1000); setExpiresAt(receivedAt + result.expiresIn * 1000);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : "发送失败，请稍后重试");
    } finally { finish(); }
  };
  const refresh = async () => {
    const updated = await refreshUser();
    if (current()) {
      setRefreshed(updated);
      if (!updated) setError("手机号已更换，但账号状态刷新失败，请联网后重试刷新。");
    }
  };
  const verify = async () => {
    if (!challenge || success || Date.now() >= expiresAt || !/^\d{6}$/.test(code) || !begin()) return;
    const submittedCode = code; setCode("");
    try {
      const result = await requestJson(fetch, "/api/v1/auth/phone-binding/replace/verify", {
        method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, code: submittedCode }), signal: controller.current!.signal,
      }, boundSchema);
      if (!current()) return;
      setSuccess(true); setChallenge(null); setPassword(""); setNewPhone(""); onBound(result.phoneMasked);
      await refresh();
    } catch (reason) {
      if (!current()) return;
      if (reason instanceof ApiError && invalidChallenges.has(reason.code || "")) setChallenge(null);
      setError(reason instanceof Error ? reason.message : "更换结果尚未确认，请联网后查看账号状态再重试");
    } finally { finish(); }
  };
  return <Modal visible transparent animationType="slide" onRequestClose={close}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end bg-black/40">
    <View className="max-h-[90%] rounded-t-3xl border-t border-line bg-surface p-6">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}>
        <Text accessibilityRole="header" className="text-xl font-bold text-ink">更换手机号</Text>
        {success ? <>
          <Text className="text-ink">手机号已更换并验证。后续可用新号码短信登录原账号，旧号码不再能登录，全部业务数据保留。</Text>
          {refreshed ? <Text className="text-brand">账号状态已刷新</Text> : <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={async () => { if (!begin()) return; try { await refresh(); } finally { finish(); } }}><Text className="text-brand">重新刷新账号状态</Text></TouchableOpacity>}
        </> : <>
          <Text className="text-sm leading-5 text-copy-muted">更换前需先验证当前登录密码和新手机。更换成功后，原手机号不再能登录，全部业务数据（库存、饮食记录等）自动保留。</Text>
          <TextInput accessibilityLabel="新手机号" placeholder="新中国大陆手机号（+86）" value={newPhone} onChangeText={setNewPhone}
            editable={!busy && !challenge} keyboardType="phone-pad" autoComplete="off" autoCorrect={false} maxLength={14} className="rounded-xl border border-line p-4 text-ink" />
          {!!challenge && <>
            <Text className="text-copy-muted">短信服务已受理发送至 {challenge.phoneMasked} 的请求；实际送达以手机收码为准。</Text>
            <Text className="text-copy-muted">{expired ? "验证码已过期，请重新获取" : "验证码 5 分钟内有效"}</Text>
            <TextInput accessibilityLabel="更换验证码" placeholder="6 位验证码" value={code} onChangeText={value => setCode(value.replace(/\D/g, "").slice(0, 6))}
              editable={!busy && !expired} keyboardType="number-pad" maxLength={6} autoComplete="off" autoCorrect={false} className="rounded-xl border border-line p-4 text-ink" />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="确认更换" disabled={busy || expired || code.length !== 6} onPress={() => void verify()} className="rounded-xl bg-brand-fill p-4"><Text className="text-center font-bold text-white">{busy ? "处理中…" : "确认更换"}</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { setChallenge(null); setCode(""); setPassword(""); setError(""); }}><Text className="text-brand">返回修改新手机号</Text></TouchableOpacity>
          </>}
          <TextInput accessibilityLabel="更换当前密码" placeholder={challenge ? "重新发送需再次输入当前密码" : "当前登录密码"} value={password} onChangeText={setPassword}
            secureTextEntry autoComplete="off" textContentType="none" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy} className="rounded-xl border border-line p-4 text-ink" />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="发送更换验证码" disabled={busy || cooldown > 0 || !password} onPress={() => void send()} className="rounded-xl bg-background-secondary p-4"><Text className="text-center text-brand">{cooldown > 0 ? `${cooldown} 秒后可重发` : busy ? "处理中…" : "发送验证码"}</Text></TouchableOpacity>
        </>}
        {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭手机号更换" onPress={close} className="p-3"><Text className="text-center text-copy-muted">{success ? "完成" : "取消"}</Text></TouchableOpacity>
        {!success && <Text className="text-xs text-copy-muted">提交后关闭页面不会撤销服务端已完成的换绑；再次打开前会重新读取账号状态。</Text>}
      </ScrollView>
    </View>
  </KeyboardAvoidingView></Modal>;
}
