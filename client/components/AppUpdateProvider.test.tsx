import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppUpdateProvider, useAppUpdate } from './AppUpdateProvider';
import { apkUpdates, checkAppUpdate, installedApp, type DownloadProgress } from '@/services/appUpdates';

const release = {
  schemaVersion: 1, platform: 'android', applicationId: 'com.dietdigidose.app.preview', channel: 'preview',
  version: '1.0.6', snapshot: '26w41a', buildNumber: 264101, url: 'https://downloads.example.com/app.apk',
  sizeBytes: 12345678, sha256: 'a'.repeat(64), releaseNotes: '修复更新问题', publishedAt: '2026-10-07T00:00:00.000Z',
} as const;
const identity = { applicationId: release.applicationId, channel: 'preview' as const, buildNumber: 263801, version: '1.0.6', snapshot: '26w38a', downloadOrigins: ['https://downloads.example.com'] };
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('@/services/appUpdates', () => ({
  ...jest.requireActual('@/services/appUpdates'),
  installedApp: jest.fn(), checkAppUpdate: jest.fn(),
  apkUpdates: { addListener: jest.fn(), download: jest.fn(), cancelDownload: jest.fn(), install: jest.fn() },
}));

let check: () => void;
let tree: renderer.ReactTestRenderer;
const remove = jest.fn();
let notify: (value: DownloadProgress) => void;
function Consumer() {
  const update = useAppUpdate();
  useEffect(() => { check = update.check; }, [update.check]);
  return null;
}
async function mount() { await act(async () => { tree = renderer.create(<AppUpdateProvider><Consumer /></AppUpdateProvider>); }); }
async function press(label: string) {
  await act(async () => {
    const button = tree.root.findAllByType(TouchableOpacity).find((item) => item.findAllByType(Text).some((text) => text.props.children === label));
    expect(button).toBeDefined();
    button!.props.onPress();
  });
}
const shown = () => JSON.stringify(tree.toJSON());

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(installedApp).mockReturnValue(identity);
  jest.mocked(checkAppUpdate).mockResolvedValue(release);
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue();
  jest.mocked(apkUpdates!.addListener).mockImplementation((_event, listener) => { notify = listener; return { remove }; });
  jest.mocked(apkUpdates!.download).mockResolvedValue();
  jest.mocked(apkUpdates!.install).mockResolvedValue('opened');
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.useRealTimers(); });

test('automatic check is delayed, throttled, and manual check bypasses postponement', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ checkedAt: Date.now(), postponedUntil: Date.now() + 86400000 }));
  await mount();
  expect(checkAppUpdate).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(checkAppUpdate).not.toHaveBeenCalled();
  await act(async () => check());
  expect(shown()).toContain('26w41a');
  await press('稍后再说');
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(expect.any(String), expect.stringContaining('postponedUntil'));
});

test('manual check errors show recovery rather than reporting latest', async () => {
  jest.mocked(checkAppUpdate).mockRejectedValue(new Error('503'));
  await mount();
  await act(async () => check());
  expect(shown()).toContain('暂时无法检查更新');
  expect(shown()).not.toContain('暂无更高版本');
  expect(shown()).toContain('重新检查');
});

test('failed validation/download never enables installation and can retry', async () => {
  jest.mocked(apkUpdates!.download).mockRejectedValueOnce(new Error('安装包校验失败'));
  await mount();
  await act(async () => check());
  await press('下载更新');
  expect(shown()).toContain('安装包校验失败');
  expect(shown()).not.toContain('安装更新');
  expect(apkUpdates!.install).not.toHaveBeenCalled();
  await press('下载更新');
  expect(shown()).toContain('安装更新');
});

test('cancel ignores late progress/success and removes the native listener', async () => {
  let resolve: () => void;
  jest.mocked(apkUpdates!.download).mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  await mount();
  await act(async () => check());
  await press('下载更新');
  const requestId = jest.mocked(apkUpdates!.download).mock.calls[0][0];
  act(() => notify({ requestId, received: 5000, total: release.sizeBytes }));
  await press('取消下载');
  expect(apkUpdates!.cancelDownload).toHaveBeenCalledWith(requestId);
  await act(async () => { notify({ requestId, received: release.sizeBytes, total: release.sizeBytes }); resolve!(); });
  expect(shown()).toContain('下载已取消');
  expect(shown()).not.toContain('安装更新');
  expect(remove).toHaveBeenCalled();
});

test('withdrawn recommendation blocks installation even after download was verified', async () => {
  await mount();
  await act(async () => check());
  await press('下载更新');
  jest.mocked(checkAppUpdate).mockResolvedValueOnce(null);
  await press('安装更新');
  expect(apkUpdates!.install).not.toHaveBeenCalled();
  expect(shown()).toContain('推荐版本已变更或撤下');
});

test('permission settings return allows explicit retry; installer launch is not reported as success', async () => {
  jest.mocked(apkUpdates!.install).mockResolvedValueOnce('permissionRequired');
  await mount();
  await act(async () => check());
  await press('下载更新');
  await press('安装更新');
  expect(shown()).toContain('返回后再次点击');
  await press('安装更新');
  expect(checkAppUpdate).toHaveBeenCalledTimes(3);
  expect(shown()).toContain('安装结果以系统提示为准');
});

test('offline recheck preserves verified download and does not enter system installer', async () => {
  await mount();
  await act(async () => check());
  await press('下载更新');
  jest.mocked(checkAppUpdate).mockRejectedValueOnce(new Error('offline'));
  await press('安装更新');
  expect(apkUpdates!.install).not.toHaveBeenCalled();
  expect(shown()).toContain('未启动安装');
  expect(shown()).toContain('安装更新');
});
