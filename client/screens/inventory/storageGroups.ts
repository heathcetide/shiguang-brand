import { groupInventoryByStorage, type InventoryStorageDisplay } from "@/utils/inventory";
import type { InventoryItem } from "./types";

const STORAGE_GROUPS = [
  {
    key: "冷藏",
    title: "冷藏存放区",
    subtitle: "已记录为冷藏存放",
    icon: "snowflake",
    iconColorClass: "accent-brand",
    iconBg: "bg-brand-soft",
    folderBg: "bg-surface border-brand",
  },
  {
    key: "冷冻",
    title: "冷冻存放区",
    subtitle: "已记录为冷冻存放",
    icon: "snowflake",
    iconColorClass: "accent-info",
    iconBg: "bg-info-soft",
    folderBg: "bg-surface border-info/30",
  },
  {
    key: "常温",
    title: "常温存放区",
    subtitle: "已记录为常温存放",
    icon: "box-open",
    iconColorClass: "accent-warm",
    iconBg: "bg-warm-soft",
    folderBg: "bg-surface border-line",
  },
  {
    key: "位置待确认",
    title: "位置待确认",
    subtitle: "请编辑食材确认存放位置",
    icon: "circle-question",
    iconColorClass: "accent-warm",
    iconBg: "bg-warm-soft",
    folderBg: "bg-surface border-line",
  },
] satisfies Array<{
  key: InventoryStorageDisplay;
  title: string;
  subtitle: string;
  icon: string;
  iconColorClass: string;
  iconBg: string;
  folderBg: string;
}>;

export function buildInventoryStorageGroups(items: InventoryItem[]) {
  const grouped = groupInventoryByStorage(items);
  return STORAGE_GROUPS.map(group => ({ ...group, items: grouped[group.key] }));
}
