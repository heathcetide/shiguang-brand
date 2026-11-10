import sproutAvatar from '../assets/avatars/sprout.png';
import citrusAvatar from '../assets/avatars/citrus.png';
import grainAvatar from '../assets/avatars/grain.png';
import mushroomAvatar from '../assets/avatars/mushroom.png';
import saladAvatar from '../assets/avatars/salad.png';
import berryAvatar from '../assets/avatars/berry.png';

const DEFAULT_AVATARS = [
  sproutAvatar,
  citrusAvatar,
  grainAvatar,
  mushroomAvatar,
  saladAvatar,
  berryAvatar,
];

const PRESET_PREFIX = 'preset-avatar:';
const LEGACY_DEFAULT_AVATARS = new Set([
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80',
]);

const stableAvatarIndex = (identity?: string | number | null) => {
  const value = String(identity ?? 'shiguang');
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash % DEFAULT_AVATARS.length;
};

export const getAvatarUrl = (
  avatarUrl?: string | null,
  identity?: string | number | null,
) => {
  if (avatarUrl?.startsWith(PRESET_PREFIX)) {
    const presetIndex = Number(avatarUrl.slice(PRESET_PREFIX.length));
    if (Number.isInteger(presetIndex) && presetIndex >= 0) {
      return DEFAULT_AVATARS[presetIndex % DEFAULT_AVATARS.length];
    }
  }

  if (avatarUrl && !LEGACY_DEFAULT_AVATARS.has(avatarUrl)) {
    return avatarUrl;
  }

  return DEFAULT_AVATARS[stableAvatarIndex(identity)];
};
