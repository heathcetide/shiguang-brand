import { resolveMediaUrl } from "./mediaUrl";

jest.mock("@/utils/config", () => ({ API_BASE: "https://api.example.com/" }));

test("resolves stored media against the backend for native and web displays", () => {
  expect(resolveMediaUrl("/media/uploads/community/42/photo.png")).toBe("https://api.example.com/media/uploads/community/42/photo.png");
});

test.each(["https://storage.example.com/photo.png", "data:image/png;base64,AAAA", "file:///photo.png"])("preserves existing image source %s", url => {
  expect(resolveMediaUrl(url)).toBe(url);
});
