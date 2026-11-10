import { APP_BUILD_TIME, APP_VERSION } from "@/utils/appVersion";
import { publicFetch, requestJson } from "./client";

export type VersionInfo = {
  serverVersion: string;
  serverBuildTime: string;
  clientVersion: string | null;
  clientBuildTime: string | null;
};

export type AIDataPolicy = {
  providerName: string;
  providerPrivacyUrl: string | null;
  processingRegion: string;
  conversationRetentionDays: number;
  supportContact: string;
};

export const systemApi = {
  version: () => requestJson<VersionInfo>(publicFetch, "/api/v1/version", {
    headers: {
      "x-client-version": APP_VERSION,
      "x-client-build-time": APP_BUILD_TIME,
    },
  }),
  aiDataPolicy: () => requestJson<AIDataPolicy>(publicFetch, "/api/v1/ai-data-policy"),
};
