import { useEffect, useRef, useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ReauthPurpose } from "@dietdigidose/contracts";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { requestJson } from "@/services/api/client";

export function AccountSmsVerification({ purpose, onVerified, disabled = false }: {
  purpose: ReauthPurpose; onVerified: (token: string | null) => void; disabled?: boolean;
}) {
  const { user, sessionGeneration } = useAuth();
  const fetch = useAuthFetch();
  const [challenge, setChallenge] = useState("");
  const [masked, setMasked] = useState("");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const sending = useRef(false);
  const generation = useRef(0);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onVerified); callback.current = onVerified;
  useEffect(() => {
    active.current=true; generation.current++;
    setChallenge(""); setMasked(""); setCode(""); setVerified(false); setBusy(false); setError(""); setCooldown(0);
    sending.current=false; callback.current(null);
    return () => { active.current=false; generation.current++; if (expiry.current) clearTimeout(expiry.current); callback.current(null); };
  },[user?.id,sessionGeneration,purpose]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0,value-1)),1000);
    return () => clearTimeout(timer);
  },[cooldown]);
  const send = async () => {
    if (sending.current || disabled || cooldown>0) return;
    const current = generation.current; sending.current=true; setBusy(true); setError(""); setVerified(false); callback.current(null);
    try {
      const result = await requestJson<{challengeId:string;phoneMasked:string;resendAfter:number}>(fetch,"/api/v1/auth/reauth/sms/send",{
        method:"POST",body:JSON.stringify({purpose}),
      });
      if (!active.current || current!==generation.current) return;
      setChallenge(result.challengeId); setMasked(result.phoneMasked); setCode(""); setCooldown(result.resendAfter || 60);
    } catch (reason) { if(active.current && current===generation.current) setError(reason instanceof Error ? reason.message : "发送失败，请重试"); }
    finally { if(active.current && current===generation.current) {sending.current=false;setBusy(false);} }
  };
  const verify = async () => {
    if(sending.current || disabled || !/^\d{6}$/.test(code)) return;
    const current=generation.current; sending.current=true;setBusy(true);setError("");
    try {
      const result=await requestJson<{reauthToken:string;expiresIn:number}>(fetch,"/api/v1/auth/reauth/sms/verify",{
        method:"POST",body:JSON.stringify({purpose,challengeId:challenge,code}),
      });
      if(!active.current || current!==generation.current) return;
      setCode("");setVerified(true);callback.current(result.reauthToken);
      if(expiry.current) clearTimeout(expiry.current);
      expiry.current=setTimeout(() => {if(active.current && current===generation.current) {setVerified(false);setChallenge("");callback.current(null);setError("验证已过期，请重新获取验证码");}},result.expiresIn*1000);
    } catch(reason) { if(active.current && current===generation.current) setError(reason instanceof Error ? reason.message : "验证失败，请重试"); }
    finally {if(active.current && current===generation.current) {sending.current=false;setBusy(false);} }
  };
  return <View className="gap-3">
    <Text className="text-copy-muted">通过已绑定手机验证身份，用于{purpose==="account_delete" ? "永久删除账号" : "设置登录密码"}。</Text>
    {verified ? <Text className="text-brand">身份已验证，请在 5 分钟内完成操作。</Text> : <>
      <TouchableOpacity accessibilityRole="button" disabled={disabled || busy || cooldown>0} onPress={() => void send()} className="rounded-xl bg-background-secondary p-3">
        <Text className="text-brand">{cooldown>0 ? `${cooldown} 秒后可重发` : busy ? "处理中…" : challenge ? "重新发送验证码" : "获取验证短信"}</Text>
      </TouchableOpacity>
      {!!challenge && <>
        <Text className="text-copy-muted">验证码已发送至 {masked}，5 分钟内有效。</Text>
        <TextInput accessibilityLabel="身份验证码" value={code} onChangeText={(value) => setCode(value.replace(/\D/g,"").slice(0,6))} maxLength={6}
          keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" placeholder="6 位验证码" editable={!busy && !disabled} className="rounded-xl border border-line bg-surface p-3 text-ink" />
        <TouchableOpacity accessibilityRole="button" disabled={busy || disabled || code.length!==6} onPress={() => void verify()} className="rounded-xl bg-brand-fill p-3"><Text className="text-center text-white">验证身份</Text></TouchableOpacity>
      </>}
    </>}
    {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
  </View>;
}
