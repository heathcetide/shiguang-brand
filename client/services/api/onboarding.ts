import {
  onboardingStateSchema,
  onboardingUpdateSchema,
  type OnboardingUpdate,
} from "@dietdigidose/contracts";
import { publicFetch, requestJson } from "./client";

const path = "/api/v1/onboarding";
export const onboardingApi = {
  get: (token: string) => requestJson(publicFetch, path, {
    headers: { Authorization: `Bearer ${token}` },
  }, onboardingStateSchema),
  update: (token: string, input: OnboardingUpdate) => requestJson(publicFetch, path, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(onboardingUpdateSchema.parse(input)),
  }, onboardingStateSchema),
  saveFailed: (token: string, requestKey: string) => requestJson(publicFetch, `${path}/save-failed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ requestKey }),
  }, onboardingStateSchema),
};
