import { communityApi } from "./community";
const mockRequestJson = jest.fn();
jest.mock("./client", () => ({ requestJson: (...args: unknown[]) => mockRequestJson(...args), publicFetch: jest.fn() }));
beforeEach(() => mockRequestJson.mockReset());
test("bookmark API sends explicit idempotent desired states and validates response", () => {
  const fetcher = jest.fn();
  communityApi.setBookmark(fetcher, 42, true);
  communityApi.setBookmark(fetcher, 42, false);
  expect(mockRequestJson.mock.calls.map(call => call.slice(0, 3))).toEqual([
    [fetcher, "/api/v1/community/posts/42/bookmark", { method: "PUT" }],
    [fetcher, "/api/v1/community/posts/42/bookmark", { method: "DELETE" }],
  ]);
  expect(mockRequestJson.mock.calls[0][3].safeParse({ bookmarked: "false" }).success).toBe(false);
});
test("post detail bypasses cached private state on reentry and after uncertain mutation failures", () => {
  const fetcher = jest.fn(); communityApi.post(42, fetcher);
  expect(mockRequestJson).toHaveBeenCalledWith(fetcher, "/api/v1/community/posts/42", { cache: "no-store" });
});
