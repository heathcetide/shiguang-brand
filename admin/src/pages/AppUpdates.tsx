import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminSelect,
  AdminTextarea,
  DialogFrame,
  PageHeader,
  Section,
  StatusBadge,
} from '@/components/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import api from '@/services/api';
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

const CHANNELS: {
  id: AppUpdateChannel;
  label: string;
  defaultAppId: string;
  badgeVariant: 'secondary' | 'warning' | 'success';
}[] = [
  { id: 'preview', label: '内测预览 (Preview)', defaultAppId: 'com.dietdigidose.app.preview', badgeVariant: 'secondary' },
  { id: 'candidate', label: '候选发布 (Candidate)', defaultAppId: 'com.dietdigidose.app', badgeVariant: 'warning' },
  { id: 'production', label: '正式发布 (Production)', defaultAppId: 'com.dietdigidose.app', badgeVariant: 'success' },
];

export default function AppUpdates() {
  const [data, setData] = useState<AppUpdatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  const [channel, setChannel] = useState<AppUpdateChannel>('preview');
  const [applicationId, setApplicationId] = useState('com.dietdigidose.app.preview');
  const [version, setVersion] = useState('1.0.6');
  const [snapshot, setSnapshot] = useState('26w44a');
  const [buildNumber, setBuildNumber] = useState<number>(264401);
  const [url, setUrl] = useState('');
  const [sizeBytes, setSizeBytes] = useState<number>(0);
  const [sha256, setSha256] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');

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
      <div className="text-muted-foreground flex min-h-[360px] items-center justify-center text-sm">
        <LoaderCircle className="mr-2 animate-spin" size={18} />
        正在加载应用更新服务配置…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="应用发布更新"
        description="管理各渠道 Android APK 更新清单（Manifest），配合客户端实现应用内增量检查与下载安装。"
        actions={
          <>
            <AdminButton type="button" onClick={() => void loadData(true)} disabled={refreshing}>
              <RefreshCw className={refreshing ? 'animate-spin' : ''} size={15} />
              刷新
            </AdminButton>
            <AdminButton type="button" variant="primary" onClick={() => openPublishModal()}>
              <PlusCircle size={16} />
              发布新版本
            </AdminButton>
          </>
        }
      />

      {message ? (
        <div className="border-success/25 bg-success/10 text-success flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium">
          <CheckCircle2 size={16} className="shrink-0" />
          <span>{message}</span>
        </div>
      ) : null}

      {error ? (
        <div className="border-destructive/20 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="min-w-0 break-all select-text" role="alert">
            {error}
          </span>
        </div>
      ) : null}

      <Section title="服务配置与下载源白名单">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="py-4">
            <CardContent className="px-4">
              <p className="text-muted-foreground text-xs font-semibold">清单文件 (Manifest Path)</p>
              <p className="text-foreground mt-1 font-mono text-sm">
                {data?.manifestPath || '未配置 APP_UPDATE_MANIFEST_PATH'}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                {data?.configured ? (
                  <StatusBadge tone="success">清单服务可用</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">未配置或清单不可用</StatusBadge>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="px-4">
              <p className="text-muted-foreground text-xs font-semibold">允许的 APK 下载源 (Allowed Origins)</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {data?.allowedOrigins && data.allowedOrigins.length > 0 ? (
                  data.allowedOrigins.map((origin) => (
                    <span
                      key={origin}
                      className="bg-muted text-foreground rounded-lg px-2 py-1 font-mono text-xs"
                    >
                      {origin}
                    </span>
                  ))
                ) : (
                  <span className="text-warning text-xs">尚未配置任何可信域名 (APP_UPDATE_ALLOWED_ORIGINS)</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="各渠道在线版本">
        <div className="grid gap-4 sm:grid-cols-3">
          {CHANNELS.map((ch) => {
            const channelReleases = data?.manifest?.releases?.filter((item) => item.channel === ch.id) || [];
            return (
              <Card key={ch.id} className="flex flex-col justify-between py-0">
                <CardHeader className="border-border border-b px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={ch.badgeVariant}>{ch.label}</Badge>
                    {channelReleases.length > 0 ? (
                      <StatusBadge tone="success">{channelReleases.length} 个版本在线</StatusBadge>
                    ) : (
                      <span className="text-muted-foreground text-xs">未发布</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-5 py-4">
                  {channelReleases.length > 0 ? (
                    <div className="space-y-4">
                      {channelReleases.map((release) => {
                        const isRevoking = revoking === `${release.applicationId}:${ch.id}`;
                        return (
                          <div
                            key={release.applicationId}
                            className="border-border bg-card rounded-xl border p-4"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-foreground text-base font-bold">{release.snapshot}</p>
                                <p className="text-muted-foreground text-xs">
                                  v{release.version} · Build {release.buildNumber}
                                </p>
                              </div>
                            </div>

                            <div className="text-foreground mt-2 space-y-1 font-mono text-xs">
                              <p className="text-muted-foreground truncate" title={release.applicationId}>
                                包名: {release.applicationId}
                              </p>
                              <p className="text-muted-foreground">
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

                            {release.releaseNotes ? (
                              <div className="border-border bg-card mt-2 rounded-lg border p-2 text-xs text-muted-foreground">
                                <p className="text-foreground font-semibold">更新说明：</p>
                                <p className="mt-0.5 whitespace-pre-wrap">{release.releaseNotes}</p>
                              </div>
                            ) : null}

                            <div className="border-border mt-3 flex items-center justify-between border-t pt-2">
                              <a
                                href={release.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
                              >
                                测试下载 <ExternalLink size={11} />
                              </a>
                              <div className="flex items-center gap-1.5">
                                <AdminButton
                                  type="button"
                                  onClick={() => openPublishModal(ch.id, release)}
                                >
                                  更新
                                </AdminButton>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon-sm"
                                  onClick={() => void handleRevoke(release.applicationId, ch.id)}
                                  disabled={isRevoking}
                                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                  title="撤下此包名版本"
                                >
                                  {isRevoking ? (
                                    <LoaderCircle className="animate-spin" size={13} />
                                  ) : (
                                    <Trash2 size={13} />
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => openPublishModal(ch.id)}
                        className="border-border text-muted-foreground hover:border-primary/40 hover:text-foreground w-full rounded-xl border border-dashed py-2 text-center text-xs font-medium"
                      >
                        + 为此渠道添加其他包名版本
                      </button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center justify-center py-6 text-center">
                      <Smartphone size={32} className="text-muted-foreground/50 stroke-1" />
                      <p className="mt-2 text-xs">当前渠道尚未配置或发布 APK</p>
                      <AdminButton
                        type="button"
                        variant="primary"
                        className="mt-4"
                        onClick={() => openPublishModal(ch.id)}
                      >
                        发布首个版本
                      </AdminButton>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Section>

      {modalOpen ? (
        <DialogFrame
          onClose={() => setModalOpen(false)}
          busy={submitting}
          className="admin-dialog-backdrop admin-dialog-center"
          aria-label="发布新 APK 版本"
        >
          <section
            className="bg-card text-card-foreground max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl p-6 shadow-xl ring-1 ring-foreground/10 sm:p-8"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-border flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-2 text-lg font-bold text-foreground">
                <ArrowUpCircle className="text-primary" size={22} />
                发布新 APK 版本
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="关闭"
                className="text-muted-foreground hover:bg-muted rounded-xl p-1"
              >
                <X size={18} />
              </button>
            </div>

            {modalError ? (
              <div
                className="border-destructive/20 bg-destructive/10 text-destructive mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                role="alert"
              >
                <AlertTriangle size={16} className="shrink-0" />
                <span>{modalError}</span>
              </div>
            ) : null}

            <form onSubmit={handlePublish} className="mt-6 space-y-4">
              <AdminField label="发布渠道">
                <AdminSelect value={channel} onChange={(e) => handleChannelChange(e.target.value as AppUpdateChannel)}>
                  {CHANNELS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>

              <div className="grid gap-4 sm:grid-cols-2">
                <AdminField label="应用包名 (applicationId)">
                  <AdminInput
                    type="text"
                    required
                    value={applicationId}
                    onChange={(e) => setApplicationId(e.target.value)}
                  />
                </AdminField>
                <AdminField label="语义版本 (version)">
                  <AdminInput
                    type="text"
                    required
                    placeholder="1.0.6"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                  />
                </AdminField>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <AdminField label="快照代号 (snapshot，例如 26w44a)">
                  <AdminInput
                    type="text"
                    required
                    placeholder="26w44a"
                    value={snapshot}
                    onChange={(e) => handleSnapshotChange(e.target.value)}
                  />
                </AdminField>
                <AdminField label="构建编号 (buildNumber，自动计算)">
                  <AdminInput
                    type="number"
                    required
                    value={buildNumber || ''}
                    onChange={(e) => setBuildNumber(Number(e.target.value))}
                  />
                </AdminField>
              </div>

              <AdminField label="APK 绝对下载链接 (HTTPS URL)">
                <AdminInput
                  type="url"
                  required
                  placeholder="https://dietdigidose.top/downloads/...apk"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-muted-foreground mt-1 text-[11px]">
                  必须以受信任的来源域名开头（当前允许: {data?.allowedOrigins.join(', ') || '未配置'}）
                </p>
              </AdminField>

              <div className="grid gap-4 sm:grid-cols-2">
                <AdminField label="文件大小 (sizeBytes 字节)">
                  <AdminInput
                    type="number"
                    required
                    placeholder="例如 266889032"
                    value={sizeBytes || ''}
                    onChange={(e) => setSizeBytes(Number(e.target.value))}
                  />
                  {sizeBytes > 0 ? (
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      约 {(sizeBytes / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  ) : null}
                </AdminField>
                <AdminField label="SHA-256 校验和 (64 位十六进制)">
                  <AdminInput
                    type="text"
                    required
                    maxLength={64}
                    placeholder="64 位 sha256"
                    value={sha256}
                    onChange={(e) => setSha256(e.target.value)}
                    className="font-mono text-xs"
                  />
                </AdminField>
              </div>

              <AdminField label="版本更新说明 (releaseNotes)">
                <AdminTextarea
                  required
                  rows={3}
                  placeholder="请输入本次更新的主要改动与说明..."
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                />
              </AdminField>

              <div className="border-border mt-6 flex items-center justify-end gap-3 border-t pt-4">
                <AdminButton type="button" onClick={() => setModalOpen(false)}>
                  取消
                </AdminButton>
                <AdminButton type="submit" variant="primary" disabled={submitting}>
                  {submitting ? <LoaderCircle className="animate-spin" size={16} /> : null}
                  {submitting ? '提交发布中…' : '确认发布'}
                </AdminButton>
              </div>
            </form>
          </section>
        </DialogFrame>
      ) : null}
    </div>
  );
}