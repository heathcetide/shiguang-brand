import { describe, expect, it } from 'vitest';
import {
  mediaCleanupErrorMessage,
  mediaCleanupRetryConfirmation,
  mediaCleanupRetryFeedback,
  mediaCleanupStatusPresentation,
  mediaCleanupViewState,
} from './mediaCleanupModel';

describe('media cleanup admin model', () => {
  it('distinguishes loading, error, empty and ready states', () => {
    expect(mediaCleanupViewState(true, '', 0)).toBe('loading');
    expect(mediaCleanupViewState(false, '加载失败', 0)).toBe('error');
    expect(mediaCleanupViewState(false, '', 0)).toBe('empty');
    expect(mediaCleanupViewState(false, '', 1)).toBe('ready');
  });

  it('renders operational statuses', () => {
    expect(mediaCleanupStatusPresentation({ status: 'processing', stale: true, attempts: 1 }).label).toBe('执行超时');
    expect(mediaCleanupStatusPresentation({ status: 'pending', stale: false, attempts: 3 }).label).toBe('反复失败');
    expect(mediaCleanupStatusPresentation({ status: 'completed', stale: false, attempts: 1 }).label).toBe('已完成');
  });

  it('provides explicit confirmation and retry feedback', () => {
    expect(mediaCleanupRetryConfirmation({ id: 42, urlCount: 3 })).toContain('任务 #42');
    expect(mediaCleanupRetryConfirmation({ id: 42, urlCount: 3 })).toContain('3 个媒体对象');
    expect(mediaCleanupRetryFeedback(42, true)).toContain('已重试并完成');
    expect(mediaCleanupRetryFeedback(42, false)).toContain('已保留等待后续重试');
  });

  it('uses sanitized server errors for failed retries', () => {
    const error = { isAxiosError: true, response: { data: { error: '媒体清理重试失败', details: '对象存储不可用' } } };
    expect(mediaCleanupErrorMessage(error)).toBe('媒体清理重试失败：对象存储不可用');
  });
});
