const USER_PREFERENCE_PREFIX = "voice-pack-preference-v2";

export function voicePreferenceStorageKey(userId?: number) {
  return Number.isInteger(userId) && Number(userId) > 0
    ? `${USER_PREFERENCE_PREFIX}:user:${userId}`
    : `${USER_PREFERENCE_PREFIX}:anonymous`;
}

export function isVoicePackSelected(
  preference: { selectedVoiceId: string | null; selectedVersion: string | null } | null,
  voiceId: string,
  version: string,
) {
  return preference?.selectedVoiceId === voiceId && preference.selectedVersion === version;
}

export const VOICE_PREFERENCE_STORAGE_PREFIX = USER_PREFERENCE_PREFIX;
