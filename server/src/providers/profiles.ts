import type { DeploymentProfile, ProviderProfile } from "./contracts.js";

export const PROVIDER_PROFILES: Record<DeploymentProfile, ProviderProfile> = {
  china: {
    id: "china",
    providers: {
      storage: "local-filesystem",
      notification: "expo-push",
      auth: "aliyun-pnvs",
      analytics: "server-events",
      map: "disabled",
      payment: "disabled",
    },
    processingRegion: "CN",
    dataResidency: "Mainland China deployment boundary",
    capabilities: { storage: true, notification: true, auth: true, analytics: true, map: false, payment: false },
  },
  global: {
    id: "global",
    providers: {
      storage: "supabase-storage",
      notification: "expo-push",
      auth: "password-jwt",
      analytics: "server-events",
      map: "disabled",
      payment: "disabled",
    },
    processingRegion: "deployment-defined",
    dataResidency: "Selected Supabase project region",
    capabilities: { storage: true, notification: true, auth: true, analytics: true, map: false, payment: false },
  },
};

export function parseDeploymentProfile(value: string | undefined): DeploymentProfile {
  const normalized = value?.trim().toLowerCase() || "china";
  if (normalized === "china" || normalized === "global") return normalized;
  throw new Error(`DEPLOYMENT_PROFILE must be china or global; received ${JSON.stringify(value)}`);
}

export function getProviderProfile(value = process.env.DEPLOYMENT_PROFILE): ProviderProfile {
  return PROVIDER_PROFILES[parseDeploymentProfile(value)];
}

const SERVER_ONLY_ENV_NAMES = [
  "JWT_SECRET",
  "ADMIN_INITIAL_PASSWORD",
  "AI_API_KEY",
  "OPENAI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALIYUN_ACCESS_KEY_ID",
  "ALIYUN_ACCESS_KEY_SECRET",
  "ALIYUN_SMS_CALLBACK_TOKEN",
  "AUTH_AUDIT_ENCRYPTION_KEY",
] as const;

/** Fails a build if a known server credential is copied into Expo's public environment namespace. */
export function assertNoPublicServerSecrets(environment: NodeJS.ProcessEnv = process.env) {
  for (const name of SERVER_ONLY_ENV_NAMES) {
    const publicName = `EXPO_PUBLIC_${name}`;
    if (environment[publicName]?.trim()) throw new Error(`${publicName} is server-only and must not be bundled into the client`);
  }
}
