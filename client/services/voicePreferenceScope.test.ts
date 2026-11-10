import {
  isVoicePackSelected,
  voicePreferenceStorageKey,
} from "./voicePreferenceScope";

describe("voice preference account scope", () => {
  it("keeps account A, account B, and anonymous preferences separate", () => {
    expect(new Set([
      voicePreferenceStorageKey(101),
      voicePreferenceStorageKey(202),
      voicePreferenceStorageKey(),
    ]).size).toBe(3);
    expect(voicePreferenceStorageKey(101)).toMatch(/:user:101$/);
    expect(voicePreferenceStorageKey()).toMatch(/:anonymous$/);
  });

  it("only treats the exact governed version as selected", () => {
    const preference = { selectedVoiceId: "warm-cn", selectedVersion: "1.2.0" };
    expect(isVoicePackSelected(preference, "warm-cn", "1.2.0")).toBe(true);
    expect(isVoicePackSelected(preference, "warm-cn", "1.3.0")).toBe(false);
    expect(isVoicePackSelected(null, "warm-cn", "1.2.0")).toBe(false);
  });
});
