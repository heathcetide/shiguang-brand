jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { getStoredToken, removeStoredToken, setStoredToken } from "./authStorage";

const mockAsyncStorage = jest.mocked(AsyncStorage);
const mockSecureStore = jest.mocked(SecureStore);

describe("native auth token storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    mockSecureStore.setItemAsync.mockResolvedValue(undefined);
    mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);
  });

  it("uses an Android-compatible SecureStore key", async () => {
    await setStoredToken("token-value");

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("auth_token", "token-value");
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith("@auth_token");
  });

  it("migrates a token from the legacy AsyncStorage key", async () => {
    mockAsyncStorage.getItem.mockResolvedValue("legacy-token");

    await expect(getStoredToken()).resolves.toBe("legacy-token");
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith("auth_token");
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("auth_token", "legacy-token");
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith("@auth_token");
  });

  it("removes both current secure and legacy token storage", async () => {
    await removeStoredToken();

    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("auth_token");
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith("@auth_token");
  });
});
