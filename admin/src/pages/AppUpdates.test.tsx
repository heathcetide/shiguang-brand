// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { computeBuildNumberFromSnapshot } from './appUpdateSnapshot';
import AppUpdates from './AppUpdates';
import api from '../services/api';

vi.mock('../services/api', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url === '/admin/app-updates') {
        return {
          data: {
            configured: true,
            manifestPath: '/data/app-update-manifest.json',
            allowedOrigins: ['https://dietdigidose.top'],
            manifest: {
              schemaVersion: 1,
              releases: [
                {
                  schemaVersion: 1,
                  platform: 'android',
                  applicationId: 'com.dietdigidose.app.preview',
                  channel: 'preview',
                  version: '1.0.6',
                  snapshot: '26w44a',
                  buildNumber: 264401,
                  url: 'https://dietdigidose.top/downloads/26w44a.apk',
                  sizeBytes: 266889032,
                  sha256: '1460059844b4960ae95312bc9e39a419db089b3056bf4be7d267359f969b38a4',
                  releaseNotes: '支持后台烹饪计时与离线库存修复',
                  publishedAt: '2026-10-27T12:00:00.000Z',
                },
              ],
            },
            error: null,
          },
        };
      }
      return { data: {} };
    }),
    post: vi.fn(async (_url: string, body: any) => ({
      data: { success: true, message: '操作成功', body },
    })),
  },
}));

describe('AppUpdates page', () => {
  it('computes correct weekly build number from snapshot', () => {
    expect(computeBuildNumberFromSnapshot('26w44a')).toBe(264401);
    expect(computeBuildNumberFromSnapshot('26w44b')).toBe(264402);
    expect(computeBuildNumberFromSnapshot('26w01a')).toBe(260101);
    expect(computeBuildNumberFromSnapshot('invalid')).toBe(null);
  });

  it('renders app updates dashboard with configured origins and releases', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<AppUpdates />);
      });

      expect(container.textContent).toContain('应用发布更新');
      expect(container.textContent).toContain('https://dietdigidose.top');
      expect(container.textContent).toContain('26w44a');
      expect(container.textContent).toContain('Build 264401');
      expect(container.textContent).toContain('内测预览 (Preview)');
      expect(container.textContent).toContain('候选发布 (Candidate)');
      expect(container.textContent).toContain('正式发布 (Production)');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('shows manifest errors and clears them after a successful refresh', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {
      configured: false,
      manifestPath: '/data/app-update-manifest.json',
      allowedOrigins: ['https://dietdigidose.top'],
      manifest: { schemaVersion: 1, releases: [] },
      error: '清单文件内容格式无效',
    } });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<AppUpdates />));
      expect(container.textContent).toContain('清单文件内容格式无效');
      expect(container.textContent).toContain('未配置或清单不可用');
      expect(container.textContent).not.toContain('清单服务可用');
      const refresh = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === '刷新');
      expect(refresh).toBeDefined();
      await act(async () => refresh!.click());
      expect(container.textContent).not.toContain('清单文件内容格式无效');
      expect(container.textContent).toContain('清单服务可用');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it.each(['rejected', 'unavailable'])('offers the complete checksum when clipboard is %s and can retry', async (failure) => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: failure === 'unavailable' ? undefined : { writeText } });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const sha = '1460059844b4960ae95312bc9e39a419db089b3056bf4be7d267359f969b38a4';
    try {
      await act(async () => root.render(<AppUpdates />));
      const copy = container.querySelector<HTMLButtonElement>('button[title="复制完整 SHA256"]')!;
      await act(async () => copy.click());
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(`无法自动复制，请手动复制 SHA-256：${sha}`);
      expect(container.textContent).not.toContain('SHA-256 已复制');
      let complete!: () => void;
      writeText.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      await act(async () => copy.click());
      expect(container.textContent).not.toContain('SHA-256 已复制');
      expect(writeText).toHaveBeenLastCalledWith(sha);
      await act(async () => complete());
      expect(container.textContent).toContain('SHA-256 已复制');
      expect(container.textContent).not.toContain('无法自动复制');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
