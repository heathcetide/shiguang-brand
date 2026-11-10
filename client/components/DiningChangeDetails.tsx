import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { HouseholdDiningPlan } from "@dietdigidose/contracts";
import { useAuthFetch } from "@/contexts/AuthContext";
import { householdApi } from "@/services/api/households";

export function DiningChangeDetails({ label,dining }: { label: string; dining: HouseholdDiningPlan | null }) {
  const authFetch = useAuthFetch();
  const [loaded,setLoaded] = useState<{ householdId: number; fetch: typeof authFetch; names: Record<number,string> } | null>(null);
  const householdId = dining?.householdId;
  useEffect(() => {
    let active = true;
    if (householdId) void householdApi.diningMembers(authFetch,householdId).then(value => {
      if (active) setLoaded({ householdId,fetch: authFetch,names: Object.fromEntries(value.members.map(member => [member.membershipId,member.name])) });
    }).catch(() => { if (active) setLoaded(null); });
    return () => { active = false; };
  },[authFetch,householdId]);
  const names = loaded?.householdId === householdId && loaded?.fetch === authFetch ? loaded.names : {};
  return <View className="gap-1">
    <Text className="font-bold text-ink">{label}：{dining ? `${dining.participants.length}人共餐` : "个人安排"}</Text>
    {dining?.participants.map((person,index) => <Text key={person.membershipId} className="text-copy-muted">{names[person.membershipId] ?? `参与者${index+1}（成员身份待核对）`}：{person.servings}份</Text>)}
  </View>;
}
