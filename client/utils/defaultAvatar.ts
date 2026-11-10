import type { ImageSourcePropType } from "react-native";

export const DEFAULT_AVATARS = [
  require("@/assets/avatars/sprout.png"),
  require("@/assets/avatars/citrus.png"),
  require("@/assets/avatars/grain.png"),
  require("@/assets/avatars/mushroom.png"),
  require("@/assets/avatars/salad.png"),
  require("@/assets/avatars/berry.png"),
] as const;

const PRESET_PREFIX = "preset-avatar:";
const isLegacyDefaultAvatar = (avatarUrl: string) =>
  avatarUrl.includes("images.unsplash.com/photo-");

const stableAvatarIndex = (identity?: string | number | null) => {
  const value = String(identity ?? "shiguang");
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash % DEFAULT_AVATARS.length;
};

export const getPresetAvatarValue = (index: number) =>
  `${PRESET_PREFIX}${index % DEFAULT_AVATARS.length}`;

export const getAvatarSource = (
  avatarUrl?: string | null,
  identity?: string | number | null,
): ImageSourcePropType => {
  if (avatarUrl?.startsWith(PRESET_PREFIX)) {
    const presetIndex = Number(avatarUrl.slice(PRESET_PREFIX.length));
    if (Number.isInteger(presetIndex) && presetIndex >= 0) {
      return DEFAULT_AVATARS[presetIndex % DEFAULT_AVATARS.length];
    }
  }

  if (avatarUrl && !isLegacyDefaultAvatar(avatarUrl)) {
    return { uri: avatarUrl };
  }

  return DEFAULT_AVATARS[stableAvatarIndex(identity)];
};
