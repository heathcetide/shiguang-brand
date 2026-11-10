import { getAvatarSource } from "./defaultAvatar";

describe("getAvatarSource", () => {
  it("replaces any legacy Unsplash portrait, including malformed seed URLs", () => {
    const legacy = "https://images.unsplash.com/photo-1500648767791-00dcc9944761-15a19d654956?w=200";

    expect(getAvatarSource(legacy, "seed-user")).not.toEqual({ uri: legacy });
  });

  it("keeps a user-provided non-legacy remote avatar", () => {
    const custom = "https://cdn.example.com/avatar.png";

    expect(getAvatarSource(custom, "real-user")).toEqual({ uri: custom });
  });
});
