import { Base64 } from "js-base64";
import { useSafeRouter } from "./useSafeRouter";

const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));

beforeEach(() => jest.clearAllMocks());

test.each(["push", "replace", "navigate"] as const)("%s preserves parameter encoding and filtering", (method) => {
  const route = useSafeRouter()[method];
  route("/recipe-detail");
  expect(mockRouter[method]).toHaveBeenLastCalledWith("/recipe-detail");

  const values = { id: 12, active: false, title: "番茄 50% & 鸡蛋", nested: { tags: ["清淡"] }, nullable: null };
  const expected = { pathname: "/recipe-detail", params: { __safeRouterPayload__: Base64.encode(JSON.stringify(values)) } };
  route("/recipe-detail", { ...values, token: "private", authorization: "private", password: "private", secret: "private", user: {}, userInfo: {}, omitted: undefined });
  expect(mockRouter[method]).toHaveBeenLastCalledWith(expected);

  route({ pathname: "/recipe-detail", params: { id: 1, password: "private" } }, values);
  expect(mockRouter[method]).toHaveBeenLastCalledWith(expected);

  route({ pathname: "/recipe-detail", params: { token: "private", omitted: undefined } });
  expect(mockRouter[method]).toHaveBeenLastCalledWith("/recipe-detail");
});

test.each(["push", "replace", "navigate"] as const)("%s still falls back to the path when serialization fails", (method) => {
  const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const params: Record<string, unknown> = {};
  params.circular = params;
  try {
    useSafeRouter()[method]("/recipe-detail", params);
    expect(mockRouter[method]).toHaveBeenLastCalledWith("/recipe-detail");
    expect(error).toHaveBeenCalledTimes(1);
  } finally {
    error.mockRestore();
  }
});
