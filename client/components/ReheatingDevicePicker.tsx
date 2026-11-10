import { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { kitchenwareApi } from "@/services/api/inventory";

export function ReheatingDevicePicker({ value, onChange, disabled }: { value?: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const [loaded, setLoaded] = useState<{ owner: number; devices: Array<{ id: number; name: string }>; error: string }>();
  const devices = loaded?.owner === user?.id ? loaded?.devices ?? [] : [];
  const error = loaded?.owner === user?.id ? loaded?.error : "";
  useEffect(() => {
    let active = true;
    if (user) void kitchenwareApi.list<{ id: number; name: string }>(authFetch).then(rows => { if (active) setLoaded({ owner: user.id, devices: rows, error: "" }); })
      .catch(() => { if (active) setLoaded({ owner: user.id, devices: [], error: "设备读取失败，复热条件暂留待核对。" }); });
    return () => { active = false; };
  }, [user?.id, authFetch]);
  return <View className="gap-2">
    <Text className="font-bold text-ink">食用地点可用的复热设备</Text>
    <Text className="text-copy-muted">只勾选食用地点实际可用的设备。未选择时，带饭复热设备保留未知；时间还需核对容量与审核流程。</Text>
    {devices.map(device => <TouchableOpacity key={device.id} disabled={disabled} accessibilityRole="checkbox" accessibilityLabel={`食用地点可用：${device.name}`} accessibilityState={{ checked: value?.includes(device.id) ?? false, disabled }} onPress={() => onChange(value?.includes(device.id) ? value.filter(id => id !== device.id) : [...(value ?? []), device.id])}>
      <Text className={value?.includes(device.id) ? "font-bold text-brand" : "text-copy-muted"}>{value?.includes(device.id) ? "已选" : "未选"} · {device.name}</Text>
    </TouchableOpacity>)}
    {error ? <Text className="text-danger">{error}</Text> : null}
  </View>;
}
