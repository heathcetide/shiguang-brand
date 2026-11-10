import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppUpdateRelease } from '@dietdigidose/contracts';
import {
  apkUpdates, installedApp, checkAppUpdate, downloadAllowed, sameUpdate, shouldAutoCheck,
  AUTO_CHECK_INTERVAL, type InstalledApp,
} from '@/services/appUpdates';

const AppUpdateContext = createContext<{ check: () => void; installed: InstalledApp | null }>({ check: () => undefined, installed: null });
export const useAppUpdate = () => useContext(AppUpdateContext);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [installed] = useState(installedApp);
  const [visible, setVisible] = useState(false);
  const [release, setRelease] = useState<AppUpdateRelease | null>(null);
  const [status, setStatus] = useState<'idle' | 'checking' | 'downloading' | 'ready' | 'installing'>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const busy = useRef(false);
  const cancelled = useRef(false);
  const operation = useRef<string | null>(null);
  const checkController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const storageKey = installed ? `@apk_updates:${installed.applicationId}:${installed.channel}:${installed.buildNumber}` : '';

  const check = useCallback(async (manual: boolean) => {
    if (busy.current) { if (manual) setVisible(true); return; }
    if (!installed) {
      if (manual) { setMessage('当前安装包不支持应用内更新，请使用发布者提供的新安装包。'); setVisible(true); }
      return;
    }
    busy.current = true;
    setStatus('checking');
    setMessage('正在检查更新…');
    setRelease(null);
    if (manual) setVisible(true);
    const controller = new AbortController();
    checkController.current = controller;
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify({ checkedAt: Date.now() })).catch(() => undefined);
      const update = await checkAppUpdate(installed, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setRelease(update);
      setMessage(update ? '' : '当前渠道暂无更高版本。');
      if (update) setVisible(true);
    } catch {
      if (mounted.current && !controller.signal.aborted) setMessage('暂时无法检查更新，请检查网络后重试。');
    } finally {
      busy.current = false;
      checkController.current = null;
      if (mounted.current) setStatus('idle');
    }
  }, [installed, storageKey]);

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      if (!installed) return;
      void AsyncStorage.getItem(storageKey).catch(() => null).then((record) => {
        if (mounted.current && shouldAutoCheck(record, Date.now())) void check(false);
      });
    }, 3000);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      checkController.current?.abort();
      if (operation.current) apkUpdates?.cancelDownload(operation.current);
    };
  }, [check, installed, storageKey]);

  const cancel = () => {
    if (operation.current) {
      cancelled.current = true;
      apkUpdates?.cancelDownload(operation.current);
      setMessage('正在取消下载…');
    }
  };

  const dismiss = () => {
    if (status === 'installing') return;
    cancel();
    checkController.current?.abort();
    setVisible(false);
    if (storageKey) void AsyncStorage.setItem(storageKey, JSON.stringify({
      checkedAt: Date.now(), postponedUntil: Date.now() + AUTO_CHECK_INTERVAL,
    })).catch(() => undefined);
  };

  const download = async () => {
    if (!release || !installed || !apkUpdates || busy.current) return;
    if (!downloadAllowed(release, installed)) {
      setMessage('此安装包尚未授权该下载来源，请联系发布者获取安装包。');
      return;
    }
    busy.current = true;
    cancelled.current = false;
    const id = `${Date.now()}-${Math.random()}`;
    operation.current = id;
    setStatus('downloading');
    setProgress(0);
    setMessage('正在下载并验证安装包…');
    const subscription = apkUpdates.addListener('downloadProgress', (event) => {
      if (mounted.current && !cancelled.current && event.requestId === operation.current) {
        setProgress(Math.max(0, Math.min(1, event.received / release.sizeBytes)));
      }
    });
    try {
      await apkUpdates.download(id, release.url, release.sizeBytes, release.sha256, release.buildNumber);
      if (!mounted.current) return;
      if (cancelled.current) { setStatus('idle'); setMessage('下载已取消，可以重新下载。'); }
      else { setStatus('ready'); setMessage('安装包校验通过，点击安装后由系统确认。'); }
    } catch (error) {
      if (mounted.current) {
        setStatus('idle');
        setMessage(cancelled.current ? '下载已取消，可以重新下载。' : updateFailure(error));
      }
    } finally {
      subscription.remove();
      operation.current = null;
      busy.current = false;
    }
  };

  const install = async () => {
    if (!release || !installed || !apkUpdates || busy.current) return;
    busy.current = true;
    setStatus('installing');
    setMessage('正在重新核对当前推荐版本…');
    const controller = new AbortController();
    checkController.current = controller;
    let recommendationChecked = false;
    try {
      const recommended = await checkAppUpdate(installed, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      recommendationChecked = true;
      if (!sameUpdate(release, recommended)) {
        setRelease(recommended);
        setStatus('idle');
        setMessage('推荐版本已变更或撤下，请重新检查并下载。');
        return;
      }
      const result = await apkUpdates.install(release.sizeBytes, release.sha256, release.buildNumber);
      if (!mounted.current) return;
      setStatus('ready');
      setMessage(result === 'permissionRequired'
        ? '请在系统设置中允许此来源安装，返回后再次点击“安装更新”。'
        : '已打开系统安装界面；如果取消了安装，可再次点击安装更新。安装结果以系统提示为准。');
    } catch (error) {
      if (mounted.current) {
        setStatus(recommendationChecked ? 'idle' : 'ready');
        setMessage(recommendationChecked ? updateFailure(error) : '暂时无法核对推荐版本，未启动安装。请联网后重试。');
      }
    } finally { busy.current = false; checkController.current = null; }
  };

  const working = status === 'checking' || status === 'downloading' || status === 'installing';
  return <AppUpdateContext.Provider value={{ check: () => { void check(true); }, installed }}>
    {children}
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View className="flex-1 justify-center bg-black/50 px-5">
        <View className="rounded-2xl bg-surface p-5" style={{ maxHeight: '85%' }} accessibilityViewIsModal>
          <Text className="text-lg font-black text-ink" accessibilityRole="header">应用更新</Text>
          <ScrollView className="mt-3" contentContainerStyle={{ paddingBottom: 12 }}>
            {release ? <>
              <Text className="font-bold text-ink">{release.version} · {release.snapshot}</Text>
              <Text className="mt-1 text-xs text-copy-muted">{(release.sizeBytes / 1024 / 1024).toFixed(1)} MB · build {release.buildNumber}</Text>
              <Text className="mt-3 text-sm text-copy">{release.releaseNotes}</Text>
              {installed && !downloadAllowed(release, installed) && <Text className="mt-3 text-sm text-copy-muted">此安装包尚未授权该下载来源，请联系发布者。</Text>}
            </> : null}
            {message ? <Text className="mt-3 text-sm text-copy-muted" accessibilityLiveRegion="polite">{message}</Text> : null}
            {status === 'downloading' ? <Text className="mt-3 font-bold text-ink" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>下载进度 {Math.round(progress * 100)}%</Text> : null}
          </ScrollView>
          {working && <ActivityIndicator accessibilityLabel="正在处理更新" />}
          {status === 'downloading' ? <UpdateButton label="取消下载" onPress={cancel} />
            : status === 'ready' ? <UpdateButton label="安装更新" onPress={() => { void install(); }} />
              : !working && release ? <UpdateButton label="下载更新" disabled={!installed || !downloadAllowed(release, installed)} onPress={() => { void download(); }} />
                : !working ? <UpdateButton label="重新检查" onPress={() => { void check(true); }} /> : null}
          {!working && release && <UpdateButton label="重新检查" onPress={() => { void check(true); }} />}
          <UpdateButton label={release ? '稍后再说' : '关闭'} disabled={status === 'installing'} onPress={dismiss} />
        </View>
      </View>
    </Modal>
  </AppUpdateContext.Provider>;
}

function UpdateButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} className={`mt-3 min-h-12 items-center justify-center rounded-xl border border-line px-4 py-3 ${disabled ? 'opacity-50' : 'bg-background-secondary'}`}>
    <Text className="font-bold text-ink">{label}</Text>
  </TouchableOpacity>;
}

function updateFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const known = ['存储空间不足', '安装包校验失败', '安装包大小不匹配', '安装包与当前应用或版本不匹配', '安装包发行渠道不匹配', '安装包签名不匹配', '安装包下载来源未授权', '安装包已失效'];
  const reason = known.find((text) => message.includes(text));
  return reason ? `${reason}。请重新检查更新并重试。` : '更新失败，请检查网络、可用空间或系统安装权限后重试。';
}
