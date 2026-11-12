import { DEFAULT_AVATAR, DEFAULT_AVATARS, getAvatarSource } from "./defaultAvatar";

describe("getAvatarSource", () => {
  it("uses the new bundled AI avatar for accounts without a custom image", () => {
    expect(getAvatarSource(null, 26)).toBe(DEFAULT_AVATAR);
    expect(getAvatarSource(undefined, "another-user")).toBe(DEFAULT_AVATAR);
  });

  it("preserves the six saved preset slots and appends the new default", () => {
    expect(DEFAULT_AVATARS).toHaveLength(7);
    for (let index = 0; index < 6; index++) {
      expect(getAvatarSource(`preset-avatar:${index}`, 26)).toBe(DEFAULT_AVATARS[index]);
    }
    expect(getAvatarSource("preset-avatar:6", 26)).toBe(DEFAULT_AVATAR);
  });
  it("replaces any legacy Unsplash portrait, including malformed seed URLs", () => {
    const legacy = "https://images.unsplash.com/photo-1500648767791-00dcc9944761-15a19d654956?w=200";

    expect(getAvatarSource(legacy, "seed-user")).not.toEqual({ uri: legacy });
  });

  it("keeps a user-provided non-legacy remote avatar", () => {
    const custom = "https://cdn.example.com/avatar.png";

    expect(getAvatarSource(custom, "real-user")).toEqual({ uri: custom });
  });
});
