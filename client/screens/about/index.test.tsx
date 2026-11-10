import React from "react";
import { Platform, Text, TouchableOpacity } from "react-native";
import renderer, { act } from "react-test-renderer";

const mockBack = jest.fn();
const mockCheck = jest.fn();
const mockVersion = jest.fn();

let mockInstalled: {
  applicationId: "com.dietdigidose.app.preview";
  buildNumber: number;
  version: string;
  channel: "preview";
  snapshot: string;
  downloadOrigins: string[];
} | null = {
  applicationId: "com.dietdigidose.app.preview",
  buildNumber: 264101,
  version: "1.0.6",
  channel: "preview",
  snapshot: "26w41a",
  downloadOrigins: ["https://dietdigidose.top"],
};

jest.mock("@/components/Screen", () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/ThemedFontAwesome6", () => "FontAwesome6");

jest.mock("@/hooks/useSafeRouter", () => ({
  useSafeRouter: () => ({
    back: mockBack,
    replace: jest.fn(),
    push: jest.fn(),
  }),
}));

jest.mock("@/components/AppUpdateProvider", () => ({
  useAppUpdate: () => ({
    check: mockCheck,
    installed: mockInstalled,
  }),
}));

jest.mock("@/services/api", () => ({
  systemApi: {
    version: () => mockVersion(),
  },
}));

jest.mock("@/utils/appVersion", () => ({
  APP_BUILD_TIME: "2026-10-18T12:00:00Z",
  APP_RELEASE_LABEL: "1.0.6 (26w42a)",
  formatBuildTime: (iso: string) => `formatted:${iso}`,
}));

import AboutScreen from "./index";

beforeEach(() => {
  jest.clearAllMocks();
  mockInstalled = {
    applicationId: "com.dietdigidose.app.preview",
    buildNumber: 264101,
    version: "1.0.6",
    channel: "preview",
    snapshot: "26w41a",
    downloadOrigins: ["https://dietdigidose.top"],
  };
});

describe("AboutScreen", () => {
  test("renders client version, native package details, and triggers update check on Android", async () => {
    Platform.OS = "android";
    mockVersion.mockResolvedValueOnce({
      serverVersion: "1.0.6",
      serverBuildTime: "2026-10-18T10:00:00Z",
    });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<AboutScreen />);
    });

    const textContent = JSON.stringify(tree.toJSON());
    expect(textContent).toContain("食光烙记");
    expect(textContent).toContain("1.0.6 (26w42a)");
    expect(textContent).toContain("26w41a · build 264101 · preview");
    expect(textContent).toContain("formatted:2026-10-18T12:00:00Z");
    expect(textContent).toContain("v1.0.6");
    expect(textContent).toContain("formatted:2026-10-18T10:00:00Z");

    const updateButton = tree.root.findAllByType(TouchableOpacity).find((btn) =>
      btn.findAllByType(Text).some((t) => t.props.children === "检查应用更新")
    );
    expect(updateButton).toBeDefined();

    act(() => {
      updateButton!.props.onPress();
    });
    expect(mockCheck).toHaveBeenCalledTimes(1);

    const backButton = tree.root.findAllByType(TouchableOpacity)[0];
    act(() => {
      backButton.props.onPress();
    });
    expect(mockBack).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
  });

  test("handles server version API failure gracefully", async () => {
    Platform.OS = "android";
    mockVersion.mockRejectedValueOnce(new Error("Network Error"));

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<AboutScreen />);
    });

    const textContent = JSON.stringify(tree.toJSON());
    expect(textContent).toContain("暂时无法获取服务信息");
    expect(textContent).toContain("客户端版本信息仍可用于问题反馈。");

    act(() => tree.unmount());
  });

  test("hides Android-specific update button on non-Android platforms", async () => {
    Platform.OS = "ios";
    mockInstalled = null;
    mockVersion.mockResolvedValueOnce({
      serverVersion: "1.0.6",
      serverBuildTime: "2026-10-18T10:00:00Z",
    });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<AboutScreen />);
    });

    const updateButton = tree.root.findAllByType(TouchableOpacity).find((btn) =>
      btn.findAllByType(Text).some((t) => t.props.children === "检查应用更新")
    );
    expect(updateButton).toBeUndefined();

    const textContent = JSON.stringify(tree.toJSON());
    expect(textContent).not.toContain("原生安装包");

    act(() => tree.unmount());
  });
});
