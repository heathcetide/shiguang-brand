import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  PlusCircle,
  RefreshCw,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import api from '../services/api';
import {
  computeBuildNumberFromSnapshot,
  type AppUpdateChannel,
  type AppUpdateManifest,
  type AppUpdateRelease,
} from './appUpdateSnapshot';

interface AppUpdatesResponse {
  configured: boolean;
  manifestPath: string;
  allowedOrigins: string[];
  manifest: AppUpdateManifest;
  error: string | null;
}

const CHANNELS: { id: AppUpdateChannel; label: string; defaultAppId: string; color: string }[] = [
  { id: 'preview', label: '内测预览 (Preview)', defaultAppId: 'com.dietdigidose.app.preview', color: 'border-purple-200 bg-purple-50 text-purple-700' },
  { id: 'candidate', label: '候选发布 (Candidate)', defaultAppId: 'com.dietdigidose.app', color: 'border-amber-200 bg-amber-50 text-amber-700' },
  { id: 'production', label: '正式发布 (Production)', defaultAppId: 'com.dietdigidose.app', color: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
];

export default function AppUpdates() {
  const [data, setData] = useState<AppUpdatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Form state
  const [channel, setChannel] = useState<AppUpdateChannel>('preview');
  const [applicationId, setApplicationId] = useState('com.dietdigidose.app.preview');
  const [version, setVersion] = useState('1.0.6');
  const [snapshot, setSnapshot] = useState('26w44a');
  const [buildNumber, setBuildNumber] = useState<number>(264401);
  const [url, setUrl] = useState('');
  const [sizeBytes, setSizeBytes] = useState<number>(0);
  const [sha256, setSha256] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');

  // Revoke confirmation
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadData = async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const res = await api.get('/admin/app-updates');
      setData(res.data);
      setError(res.data.error || '');
    } catch (err: any) {
      setError(err.response?.data?.error || '加载应用更新状态失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const copySha256 = async (value: string) => {
    setMessage('');
    setError('');
    try {
      await navigator.clipboard.writeText(value);
      setMessage('SHA-256 已复制');
    } catch {
      setError(`无法自动复制，请手动复制 SHA-256：${value}`);
    }
  };

  const handleChannelChange = (nextChannel: AppUpdateChannel) => {
    setChannel(nextChannel);
    const target = CHANNELS.find((item) => item.id === nextChannel);
    if (target) setApplicationId(target.defaultAppId);
  };

  const handleSnapshotChange = (nextSnapshot: string) => {
    setSnapshot(nextSnapshot);
    const computed = computeBuildNumberFromSnapshot(nextSnapshot);
    if (computed) setBuildNumber(computed);
  };

  const openPublishModal = (targetChannel?: AppUpdateChannel, existingRelease?: AppUpdateRelease) => {
    const selected = targetChannel || 'preview';
    setChannel(selected);
    if (existingRelease) {
      setApplicationId(existingRelease.applicationId);
      setVersion(existingRelease.version);
      setSnapshot(existingRelease.snapshot);
      setBuildNumber(existingRelease.buildNumber);
      setUrl(existingRelease.url);
      setSizeBytes(existingRelease.sizeBytes);
      setSha256(existingRelease.sha256);
      setReleaseNotes(existingRelease.releaseNotes);
    } else {
      const target = CHANNELS.find((item) => item.id === selected);
      if (target) setApplicationId(target.defaultAppId);
      setVersion('1.0.6');
      setSnapshot('26w44a');
      setBuildNumber(264401);
      setUrl('');
      setSizeBytes(0);
      setSha256('');
      setReleaseNotes('');
    }
    setModalError('');
    setModalOpen(true);
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setModalError('');
    try {
      const payload: AppUpdateRelease = {
        schemaVersion: 1,
        platform: 'android',
        applicationId: applicationId.trim(),
        channel,
        version: version.trim(),
        snapshot: snapshot.trim(),
        buildNumber: Number(buildNumber),
        url: url.trim(),
        sizeBytes: Number(sizeBytes),
        sha256: sha256.trim().toLowerCase(),
        releaseNotes: releaseNotes.trim(),
        publishedAt: new Date().toISOString(),
      };
      const res = await api.post('/admin/app-updates/publish', payload);
      setMessage(res.data.message || '版本发布成功');
      setModalOpen(false);
      await loadData(true);
    } catch (err: any) {
      setModalError(err.response?.data?.error || err.message || '发布失败，请检查参数');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (targetAppId: string, targetChannel: AppUpdateChannel) => {
    if (!window.confirm(`确认要从更新清单中撤下 ${targetChannel} 渠道的当前版本吗？\n撤下后，旧版本客户端检查更新时将不再收到该版本推送。`)) {
      return;
    }
    setRevoking(`${targetAppId}:${targetChannel}`);
    setMessage('');
    setError('');
    try {
      const res = await api.post('/admin/app-updates/revoke', {
        applicationId: targetAppId,
        channel: targetChannel,
      });
      setMessage(res.data.message || '已成功撤下该版本');
      await loadData(true);
    } catch (err: any) {
      setError(err.response?.data?.error || '撤下版本失败');
    } finally {
      setRevoking(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-text-muted">
        <LoaderCircle className="mr-2 animate-spin" size={18} />
        正在加载应用更新服务配置…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 标题 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">发布与分发</p>
          <h2 className="mt-1 text-3xl font-bold text-text-main">应用发布更新</h2>
          <p className="mt-2 text-sm text-text-muted">
            管理各渠道 Android APK 更新清单（Manifest），配合客户端实现应用内增量检查与下载安装。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-text-main shadow-xs hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} size={15} />
            刷新
          </button>
          <button
            type="button"
            onClick={() => openPublishModal()}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover"
          >
            <PlusCircle size={16} />
            发布新版本
          </button>
        </div>
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          <CheckCircle2 size={16} className="text-emerald-600" />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-800">
          <AlertTriangle size={16} className="text-red-600" />
          <span className="min-w-0 break-all select-text" role="alert">{error}</span>
        </div>
      )}

      {/* 服务配置状态 */}
      <section className="rounded-3xl border border-gray-100 bg-background p-6 shadow-sm">
        <h3 className="font-bold text-text-main">服务配置与下载源白名单</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold text-text-muted">清单文件 (Manifest Path)</p>
            <p className="mt-1 font-mono text-sm text-text-main">
              {data?.manifestPath || '未配置 APP_UPDATE_MANIFEST_PATH'}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              {data?.configured ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 size={12} /> 清单服务可用
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                  <AlertTriangle size={12} /> 未配置或清单不可用
                </span>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold text-text-muted">允许的 APK 下载源 (Allowed Origins)</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {data?.allowedOrigins && data.allowedOrigins.length > 0 ? (
                data.allowedOrigins.map((origin) => (
                  <span
                    key={origin}
                    className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-xs text-text-main"
                  >
                    {origin}
                  </span>
                ))
              ) : (
                <span className="text-xs text-amber-700">尚未配置任何可信域名 (APP_UPDATE_ALLOWED_ORIGINS)</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 各渠道发布卡片 */}
      <div className="space-y-4">
        <h3 className="font-bold text-text-main">各渠道在线版本</h3>
        <div className="grid gap-6 sm:grid-cols-3">
          {CHANNELS.map((ch) => {
            const channelReleases = data?.manifest.releases.filter((item) => item.channel === ch.id) || [];
            return (
              <div
                key={ch.id}
                className="flex flex-col justify-between rounded-3xl border border-gray-100 bg-background p-6 shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className={`rounded-xl border px-2.5 py-1 text-xs font-bold ${ch.color}`}>
                      {ch.label}
                    </span>
                    {channelReleases.length > 0 ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                        <CheckCircle2 size={13} /> {channelReleases.length} 个版本在线
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted">未发布</span>
                    )}
                  </div>

                  {channelReleases.length > 0 ? (
                    <div className="mt-4 space-y-4">
                      {channelReleases.map((release) => {
                        const isRevoking = revoking === `${release.applicationId}:${ch.id}`;
                        return (
                          <div
                            key={release.applicationId}
                            className="rounded-2xl border border-gray-100 bg-background-alt p-4"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-base font-black text-text-main">{release.snapshot}</p>
                                <p className="text-xs text-text-muted">
                                  v{release.version} · Build {release.buildNumber}
                                </p>
                              </div>
                            </div>

                            <div className="mt-2 space-y-1 font-mono text-xs text-text-main">
                              <p className="truncate text-text-muted" title={release.applicationId}>
                                包名: {release.applicationId}
                              </p>
                              <p className="text-text-muted">
                                大小: {(release.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                              </p>
                              <div className="flex items-center justify-between">
                                <span className="truncate" title={release.sha256}>
                                  SHA: {release.sha256.slice(0, 10)}…
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void copySha256(release.sha256)}
                                  className="text-primary hover:opacity-80"
                                  title="复制完整 SHA256"
                                >
                                  <Copy size={12} />
                                </button>
                              </div>
                            </div>

                            {release.releaseNotes && (
                              <div className="mt-2 rounded-lg border border-gray-100 bg-white p-2 text-xs text-text-muted">
                                <p className="font-semibold text-text-main">更新说明：</p>
                                <p className="mt-0.5 whitespace-pre-wrap">{release.releaseNotes}</p>
                              </div>
                            )}

                            <div className="mt-3 flex items-center justify-between border-t border-gray-200/50 pt-2">
                              <a
                                href={release.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                              >
                                测试下载 <ExternalLink size={11} />
                              </a>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openPublishModal(ch.id, release)}
                                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-text-main hover:bg-gray-50"
                                >
                                  更新
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRevoke(release.applicationId, ch.id)}
                                  disabled={isRevoking}
                                  className="rounded-lg border border-red-200 p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                                  title="撤下此包名版本"
                                >
                                  {isRevoking ? (
                                    <LoaderCircle className="animate-spin" size={13} />
                                  ) : (
                                    <Trash2 size={13} />
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => openPublishModal(ch.id)}
                        className="w-full rounded-xl border border-dashed border-gray-300 py-2 text-center text-xs font-medium text-text-muted hover:border-gray-400 hover:text-text-main"
                      >
                        + 为此渠道添加其他包名版本
                      </button>
                    </div>
                  ) : (
                    <div className="mt-6 flex flex-col items-center justify-center py-6 text-center text-text-muted">
                      <Smartphone size={32} className="stroke-1 text-gray-300" />
                      <p className="mt-2 text-xs">当前渠道尚未配置或发布 APK</p>
                      <button
                        type="button"
                        onClick={() => openPublishModal(ch.id)}
                        className="mt-4 rounded-xl bg-primary/10 px-4 py-1.5 text-center text-xs font-bold text-primary hover:bg-primary/20"
                      >
                        发布首个版本
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 发布模态框 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-xl sm:p-8">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2 text-lg font-bold text-text-main">
                <ArrowUpCircle className="text-primary" size={22} />
                发布新 APK 版本
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl p-1 text-text-muted hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {modalError && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl bg-red-50 p-4 text-sm text-red-800">
                <AlertTriangle size={16} className="text-red-600" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handlePublish} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-text-main">发布渠道</label>
                <select
                  value={channel}
                  onChange={(e) => handleChannelChange(e.target.value as AppUpdateChannel)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-text-main outline-none focus:border-primary"
                >
                  {CHANNELS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-text-main">应用包名 (applicationId)</label>
                  <input
                    type="text"
                    required
                    value={applicationId}
                    onChange={(e) => setApplicationId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm text-text-main outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-main">语义版本 (version)</label>
                  <input
                    type="text"
                    required
                    placeholder="1.0.6"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm text-text-main outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-text-main">快照代号 (snapshot，例如 26w44a)</label>
                  <input
                    type="text"
                    required
                    placeholder="26w44a"
                    value={snapshot}
                    onChange={(e) => handleSnapshotChange(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm text-text-main outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-main">构建编号 (buildNumber，自动计算)</label>
                  <input
                    type="number"
                    required
                    value={buildNumber || ''}
                    onChange={(e) => setBuildNumber(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm text-text-main outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-main">APK 绝对下载链接 (HTTPS URL)</label>
                <input
                  type="url"
                  required
                  placeholder="https://dietdigidose.top/downloads/...apk"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm text-text-main outline-none focus:border-primary"
                />
                <p className="mt-1 text-[11px] text-text-muted">
                  必须以受信任的来源域名开头（当前允许: {data?.allowedOrigins.join(', ') || '未配置'}）
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-text-main">文件大小 (sizeBytes 字节)</label>
                  <input
                    type="number"
                    required
                    placeholder="例如 266889032"
                    value={sizeBytes || ''}
                    onChange={(e) => setSizeBytes(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm text-text-main outline-none focus:border-primary"
                  />
                  {sizeBytes > 0 && (
                    <p className="mt-1 text-[11px] text-text-muted">
                      约 {(sizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-main">SHA-256 校验和 (64 位十六进制)</label>
                  <input
                    type="text"
                    required
                    maxLength={64}
                    placeholder="64 位 sha256"
                    value={sha256}
                    onChange={(e) => setSha256(e.target.value)}
                    className="mt-1 w-full font-mono text-xs rounded-xl border border-gray-200 p-3 text-text-main outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-main">版本更新说明 (releaseNotes)</label>
                <textarea
                  required
                  rows={3}
                  placeholder="请输入本次更新的主要改动与说明..."
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm text-text-main outline-none focus:border-primary"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-2xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-text-main hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-2xl bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50"
                >
                  {submitting && <LoaderCircle className="animate-spin" size={16} />}
                  {submitting ? '提交发布中…' : '确认发布'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
