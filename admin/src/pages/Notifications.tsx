import { useCallback, useEffect, useState } from 'react';
import { Bell, Eye, Inbox, Loader2, MousePointerClick, RefreshCw, Send, Smartphone, Users } from 'lucide-react';
import api from '../services/api';
import { hasCompleteNotificationOverview, parseNotificationOverview, type NotificationOverview } from '../utils/adminResponses';
import { AdminButton, AdminInput, AdminTextarea, EmptyState, PageHeader, Section } from '../components/admin';

const interventionLabels = {
  candidates: '候选数', suppressed: '策略未发送', inbox_only: '仅站内', accepted: '推送已接受', uncertain: '投递不确定',
  failed: '投递失败', acted: '已处理候选', action_plan_recipe: '安排菜谱', cooking_started: '实际开始烹饪',
  inventory_used: '确认已使用', inventory_discarded: '确认已丢弃', action_not_helpful: '反馈没帮助', expired_unhandled: '已过期未处理',
};

export default function Notifications() {
  const [data, setData] = useState<NotificationOverview | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const overviewComplete = data !== null && hasCompleteNotificationOverview(data);
  const unavailable = loading ? '—' : '不可用';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(parseNotificationOverview((await api.get<unknown>('/admin/notifications')).data)); }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : '加载通知数据失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!title.trim() || !body.trim() || sending || loading || !overviewComplete || error) return;
    if (!window.confirm('将为所有有效用户创建站内通知，并向已授权设备额外推送，确认继续？')) return;
    setSending(true);
    try {
      await api.post('/admin/notifications/campaigns', { title: title.trim(), body: body.trim() });
      setTitle(''); setBody(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '发送失败'); }
    finally { setSending(false); }
  };

  return (
    <div className="admin-stack">
      <PageHeader
        title="通知中心"
        description="发送运营通知，并追踪自动临期提醒的投递情况。"
        actions={
          <AdminButton aria-label="刷新通知数据" disabled={loading || sending} onClick={() => void load()}>
            <RefreshCw size={16} />
            刷新
          </AdminButton>
        }
      />
      {error && <p role="alert" className="admin-error">{error}</p>}
      {loading && <p role="status" className="admin-muted">正在加载通知数据...</p>}
      {!loading && data && !overviewComplete && (
        <p role="status" className="admin-error">
          当前接口仅提供部分通知数据；缺失统计显示为“不可用”，通知发送暂不可用。请联系管理员核对服务端版本。
        </p>
      )}

      <div className="admin-stat-grid">
        <Stat icon={Smartphone} label="活跃推送设备" value={data?.activeDevices ?? unavailable} />
        <Stat icon={Users} label="已开启提醒用户" value={data?.enabledUsers ?? unavailable} />
        <Stat icon={Inbox} label="30 天创建" value={data?.metrics?.created ?? unavailable} />
        <Stat icon={Eye} label="30 天打开" value={data?.metrics?.opened ?? unavailable} />
        <Stat icon={MousePointerClick} label="30 天动作点击" value={data?.metrics?.actionClicks ?? unavailable} />
      </div>

      <Section title="推送链路（近 30 天）">
        <div className="admin-metric-grid">
          <Metric label="已提交 Expo" value={data?.metrics?.pushSubmitted ?? unavailable} />
          <Metric label="Receipt 已送达" value={data?.metrics?.pushDelivered ?? unavailable} />
          <Metric label="投递失败" value={data?.metrics?.pushFailures ?? unavailable} danger />
        </div>
      </Section>

      <Section title="发送通知" icon={<Send size={18} />}>
        <div className="admin-form-stack">
          <AdminInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="通知标题" />
          <AdminTextarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder="通知内容" />
          <div className="admin-actions justify-between">
            <span className="admin-muted text-xs">
              {overviewComplete ? '所有有效用户收到站内信；已授权设备同时收到推送' : '通知数据未就绪，暂不可发送'}
            </span>
            <AdminButton
              variant="primary"
              disabled={!title.trim() || !body.trim() || sending || loading || !overviewComplete || Boolean(error)}
              onClick={() => void send()}
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              发送
            </AdminButton>
          </div>
        </div>
      </Section>

      <Section title="手动通知记录">
        {data?.campaigns === undefined ? (
          <EmptyState>{loading ? '正在读取手动通知记录' : '手动通知记录暂不可用'}</EmptyState>
        ) : data.campaigns.length ? (
          <ul className="admin-task-list">
            {data.campaigns.map((item) => (
              <li key={item.id}>
                <span className="admin-task-text">
                  <strong>{item.title}</strong>
                  <small>{item.body}</small>
                  <small>{item.adminName || '管理员未知'} · {new Date(item.createdAt).toLocaleString('zh-CN')}</small>
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  <div className="font-semibold text-primary">{item.status}</div>
                  <div>{item.successCount ?? '不可用'}/{item.recipientCount ?? '不可用'} 已接受</div>
                  {item.failureCount !== undefined && item.failureCount > 0 && <div className="text-destructive">{item.failureCount} 失败</div>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>还没有手动发送记录</EmptyState>
        )}
      </Section>

      <Section title={`主动食物提醒 · ${data?.interventionsEnabled === undefined ? '服务端状态不可用' : data.interventionsEnabled ? '服务端已启用' : '服务端已关闭'}`}>
        <p className="admin-muted">
          最近 30 天建立的候选及其已关联业务结果。加入队列不等于开始烹饪；推送接受不等于用户收到。结果只说明关联，不代表提醒造成了行为改变。
        </p>
        <div className="admin-metric-grid cols-4">
          {Object.entries(interventionLabels).map(([key, label]) => (
            <Metric key={key} label={label} value={data?.interventionMetrics?.[key] ?? unavailable} danger={key === 'failed' || key === 'uncertain'} />
          ))}
        </div>
        <div className="admin-metric-grid">
          <Metric label="进入队列的可见候选比例" value={rate(data?.interventionMetrics?.action_plan_recipe, data?.interventionMetrics?.visible)} />
          <Metric label="临期候选及时使用率" value={rate(data?.interventionMetrics?.timely_used, data?.interventionMetrics?.expiry_visible)} />
          <Metric
            label="已确认使用/丢弃结果中的使用比例"
            value={rate(
              data?.interventionMetrics?.inventory_used,
              data?.interventionMetrics?.inventory_used !== undefined && data?.interventionMetrics?.inventory_discarded !== undefined
                ? data.interventionMetrics.inventory_used + data.interventionMetrics.inventory_discarded
                : undefined,
            )}
          />
        </div>
        <p className="admin-muted text-xs">及时指在候选建立至机会失效期间确认使用；未处理不代表用户看过或忽略。无分母时不显示百分比。</p>
        <p className="admin-muted text-xs">停用时将服务端 PROACTIVE_INTERVENTIONS_ENABLED 设为 0 并重新加载服务；待发送记录会取消，已提交的推送无法撤回。具体任务失败见 worker 运行记录。</p>
      </Section>

      <Section title="自动临期提醒">
        {data?.automatic === undefined ? (
          <EmptyState>{loading ? '正在读取自动提醒记录' : '自动提醒投递记录暂不可用'}</EmptyState>
        ) : data.automatic.length ? (
          <ul className="admin-task-list">
            {data.automatic.map((item, index) => (
              <li key={`${item.deliveryDate}-${item.status}-${index}`}>
                <span>{item.deliveryDate}</span>
                <span className="admin-muted">{item.status} · {item.count} 条</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>暂无自动提醒投递记录</EmptyState>
        )}
      </Section>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Bell; label: string; value: number | string }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-icon"><Icon size={20} /></div>
      <div>
        <div className="admin-muted text-sm">{label}</div>
        <div className="admin-stat-value">{value}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="admin-metric-card">
      <div className="admin-muted text-xs">{label}</div>
      <div className={`admin-metric-value${danger && Number(value) > 0 ? ' is-danger' : ''}`}>{value}</div>
    </div>
  );
}

function rate(numerator?: number, denominator?: number) {
  return numerator === undefined || denominator === undefined
    ? '不可用'
    : denominator > 0
      ? `${((100 * numerator) / denominator).toFixed(1)}%`
      : '暂无数据';
}
