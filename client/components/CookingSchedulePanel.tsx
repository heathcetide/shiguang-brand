import { Text, View } from "react-native";
import type { CookingSchedule } from "@dietdigidose/contracts";

export function CookingSchedulePanel({ schedule, titles, heading = "制作排程" }: { schedule: CookingSchedule; titles: Record<number, string>; heading?: string }) {
  return <View className="rounded-2xl bg-surface p-4 gap-3">
    <Text className="font-black text-ink">{heading}{schedule.complete ? ` · 生成时按审核上限约 ${schedule.elapsedMinutes} 分钟` : " · 尚未完整核实"}</Text>
    <Text className="text-copy-muted">操作前需重新核对当前设备、食材与审核流程。复热后还须按审核条件检查实际温度与食物状态。</Text>
    {schedule.batches.map((batch, index) => <View key={batch.id} className="gap-1">
      <Text className="font-bold text-ink">第 {index + 1} 批 · {titles[batch.recipeId] ?? "待吃餐"}{batch.kind === "reheating" ? "复热" : "制作"} {batch.servings} 份</Text>
      <Text className="text-copy-muted">设备：{batch.devices.map(device => device.name).join("、") || "无需专用设备"}</Text>
      {schedule.tasks.filter(task => task.batchId === batch.id).map(task => <Text key={task.id} className="text-copy-muted">
        {task.startMinute}–{task.endMinute} 分钟 · {task.title}（{task.active ? "需要操作" : "等待"}）
      </Text>)}
      <Text className="text-copy-muted text-xs">审核依据：{batch.reference}</Text>
      {batch.instructions ? <Text className="text-copy-muted text-xs">{batch.instructions}</Text> : null}
      {batch.sourceUrl ? <Text selectable className="text-copy-muted text-xs">来源：{batch.sourceUrl}</Text> : null}
    </View>)}
    {!schedule.complete ? <Text className="text-copy-muted">仍有流程、设备容量或待吃餐加热时间未知，暂不能确认符合时间上限。</Text> : null}
    {schedule.conflicts.map((conflict, index) => <Text key={index} className="text-danger">{conflict}</Text>)}
  </View>;
}
