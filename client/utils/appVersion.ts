import Constants from "expo-constants";

type AppExtra = {
  appVersion?: string;
  buildTime?: string;
  releaseSnapshot?: string;
  buildNumber?: number;
};

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

export const APP_VERSION = extra.appVersion ?? Constants.expoConfig?.version ?? "未知版本";
export const APP_BUILD_TIME = extra.buildTime ?? "未记录";
export const APP_RELEASE_SNAPSHOT = extra.releaseSnapshot ?? "开发快照";
export const APP_BUILD_NUMBER = extra.buildNumber ?? "未知";
export const APP_RELEASE_LABEL = `${APP_VERSION} (${APP_RELEASE_SNAPSHOT} · build ${APP_BUILD_NUMBER})`;

export function formatBuildTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
