import axios from 'axios';

export type MediaCleanupStatus = 'pending' | 'processing' | 'completed';

export type MediaCleanupJob = {
  id: number;
  ownerUserId: number;
  urlCount: number;
  status: MediaCleanupStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  claimedAt: string | null;
  ageSeconds: number;
  stale: boolean;
  eligibleForRetry: boolean;
};

export function mediaCleanupViewState(loading: boolean, error: string, itemCount: number) {
  if (loading) return 'loading' as const;
  if (error) return 'error' as const;
  if (itemCount === 0) return 'empty' as const;
  return 'ready' as const;
}

export function mediaCleanupStatusPresentation(job: Pick<MediaCleanupJob, 'status' | 'stale' | 'attempts'>) {
  if (job.stale) return { label: '执行超时', tone: 'danger' as const };
  if (job.status === 'pending' && job.attempts >= 3) return { label: '反复失败', tone: 'danger' as const };
  if (job.status === 'pending') return { label: '等待重试', tone: 'warning' as const };
  if (job.status === 'processing') return { label: '处理中', tone: 'info' as const };
  return { label: '已完成', tone: 'success' as const };
}

export function mediaCleanupRetryConfirmation(job: Pick<MediaCleanupJob, 'id' | 'urlCount'>) {
  return `确认立即重试任务 #${job.id}？系统将重新清理 ${job.urlCount} 个媒体对象。`;
}

export function mediaCleanupRetryFeedback(jobId: number, succeeded: boolean) {
  return succeeded ? `任务 #${jobId} 已重试并完成` : `任务 #${jobId} 重试失败，已保留等待后续重试`;
}

export function mediaCleanupErrorMessage(error: unknown, fallback = '请求失败，请稍后重试') {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string; details?: string } | undefined;
    if (data?.error && data.details) return `${data.error}：${data.details}`;
    return data?.error || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
