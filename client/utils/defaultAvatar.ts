import type { ImageSourcePropType } from "react-native";

export const DEFAULT_AVATAR = require("@/assets/avatars/daily-sprout.jpg");

export const DEFAULT_AVATARS = [
  require("@/assets/avatars/sprout.png"),
  require("@/assets/avatars/citrus.png"),
  require("@/assets/avatars/grain.png"),
  require("@/assets/avatars/mushroom.png"),
  require("@/assets/avatars/salad.png"),
  require("@/assets/avatars/berry.png"),
  // Append rather than reorder: existing saved preset-avatar:0..5 keep their identity.
  DEFAULT_AVATAR,
] as const;

const PRESET_PREFIX = "preset-avatar:";
const isLegacyDefaultAvatar = (avatarUrl: string) =>
  avatarUrl.includes("images.unsplash.com/photo-");

export const getPresetAvatarValue = (index: number) =>
  `${PRESET_PREFIX}${index % DEFAULT_AVATARS.length}`;

export const getAvatarSource = (
  avatarUrl?: string | null,
  _identity?: string | number | null,
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

  return DEFAULT_AVATAR;
};
