import { useQueryState } from '@/hooks/useQueryState';
import { useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminSelect,
  EmptyState,
  PageHeader,
  Section,
  StatusBadge,
  TableContainer,
} from '@/components/admin';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Settings = { enabled: boolean; version: number; coverageStart: string | null; environment: string | null; timeZone: string };
type Actor = { userId: number; actorKey: string; kind: string; version: number };
type Report = {
  startDate: string; endDate: string; timeZone: string; version: string; status: string;
  users: number | null; loops: number | null; verifiedUsers: number; verifiedLoops: number; unknown: number;
  smallSample: boolean; coverageStart: string | null;
  evaluations: { productionId: string; actorKey: string; reason: string; completedAt: string | null }[];
  detailsTruncated: boolean;
};

const labels: Record<string, string> = {
  included: '已计入', environment_unknown: '历史环境未知', non_target_environment: '非目标环境',
  excluded_actor: '排除的账号类型', actor_unclassified: '账号未分类', not_producer: '并非制作者本人',
  selection_missing: '缺少选菜来源', selection_mismatch: '选菜与制作不一致', stock_evidence_missing: '缺少确认入库证据',
  no_inventory_match: '未匹配到库存', deduction_evidence_missing: '扣减证据不足', no_verified_deduction: '无已核实扣减',
  no_surviving_intake: '无有效实际摄入', invalid_time: '时间证据待核对',
};
const kinds: Record<string, string> = {
  unknown: '未分类', real: '真实内测用户', test: '测试账号', demo: '演示账号', automation: '自动化账号',
};
const statuses: Record<string, string> = {
  not_collected: '尚未采集', partial: '证据或覆盖不完整', in_progress: '本周进行中', complete: '完整周数据',
};

function reportStatusTone(status: string): 'neutral' | 'success' | 'warning' {
  if (status === 'complete') return 'success';
  if (status === 'partial' || status === 'in_progress') return 'warning';
  return 'neutral';
}

const errorMessage = (error: unknown) =>
  (error as { response?: { data?: { error?: string } } }).response?.data?.error || '请求未完成，请刷新核对后重试。';

export default function CoreLoops() {
  const [date, setDate] = useQueryState<string>(
    'date',
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
  );
  const [report, setReport] = useState<Report | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');
  const [actor, setActor] = useState<Actor | null>(null);
  const [kind, setKind] = useState('unknown');
  const actorSequence = useRef(0);

  useEffect(() => {
    let active = true;
    setReport(null);
    setMessage('');
    void Promise.all([
      api.get<Report>('/admin/core-loops', { params: { date, details: '1' } }),
      api.get<Settings>('/admin/core-loops/settings'),
    ])
      .then(([reportResponse, settingsResponse]) => {
        if (active) {
          setReport(reportResponse.data);
          setSettings(settingsResponse.data);
        }
      })
      .catch((error) => {
        if (active) setMessage(errorMessage(error));
      });
    return () => { active = false; };
  }, [date, refresh]);

  async function toggleCollection() {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const { data } = await api.put<Settings>('/admin/core-loops/settings', { enabled: !settings.enabled, version: settings.version });
      setSettings(data);
      setRefresh((value) => value + 1);
    } catch (error) {
      setMessage(errorMessage(error));
      setSettings(null);
    } finally {
      setSaving(false);
    }
  }

  async function readActor() {
    const sequence = ++actorSequence.current;
    setActor(null);
    if (!/^\d+$/.test(userId) || Number(userId) < 1) {
      setMessage('请输入有效用户 ID。');
      return;
    }
    try {
      const { data } = await api.get<Actor>(`/admin/core-loops/actors/${userId}`);
      if (sequence === actorSequence.current) {
        setActor(data);
        setKind(data.kind);
      }
    } catch (error) {
      if (sequence === actorSequence.current) setMessage(errorMessage(error));
    }
  }

  async function saveActor() {
    if (!actor || saving) return;
    setSaving(true);
    const sequence = actorSequence.current;
    try {
      const { data } = await api.put<Actor>(`/admin/core-loops/actors/${actor.userId}`, { kind, version: actor.version });
      if (sequence === actorSequence.current) {
        setActor(data);
        setRefresh((value) => value + 1);
      }
    } catch (error) {
      if (sequence === actorSequence.current) {
        setMessage(errorMessage(error));
        setActor(null);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="每周核心闭环"
        description="核对库存选菜、制作扣减和本人实际摄入。每人每周去重。当前可核实个人确认入库路径，其他来源证据不足时保留待核对。"
        actions={<AdminButton onClick={() => setRefresh((value) => value + 1)}>刷新核对</AdminButton>}
      />
      {message ? (
        <p role="alert" className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      <Section title="统计周">
        <AdminField label="选择周内日期" className="max-w-xs">
          <AdminInput aria-label="统计日期" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </AdminField>
        {!report ? (
          <EmptyState>{message ? '尚未取得统计结果。' : '正在核对业务记录…'}</EmptyState>
        ) : (
          <>
            <p className="text-foreground text-sm">
              {report.startDate} 至 {report.endDate}（结束日不含）· {report.timeZone}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={reportStatusTone(report.status)}>{statuses[report.status]}</StatusBadge>
              <span className="text-muted-foreground text-xs">采集起点：{report.coverageStart || '尚未启用'}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card className="py-3">
                <CardContent>
                  <p className="text-muted-foreground text-xs">周闭环用户数</p>
                  <p className="text-foreground mt-1 text-xl font-semibold">
                    {report.users === null ? '不可确定' : `${report.users} 人`}
                  </p>
                </CardContent>
              </Card>
              <Card className="py-3">
                <CardContent>
                  <p className="text-muted-foreground text-xs">有效闭环次数</p>
                  <p className="text-foreground mt-1 text-xl font-semibold">
                    {report.loops === null ? '不可确定' : `${report.loops} 次`}
                  </p>
                </CardContent>
              </Card>
            </div>
            {report.status === 'partial' && (
              <p className="text-muted-foreground text-sm">
                已核实下限：{report.verifiedUsers} 人、{report.verifiedLoops} 次；另有 {report.unknown} 条待核对。不能把未确定部分视为零。
              </p>
            )}
            {report.smallSample && <p className="text-muted-foreground text-sm">已核实用户少于 30 人，只展示实际人数。</p>}
          </>
        )}
      </Section>

      <Section title="采集范围">
        <p className="text-muted-foreground text-sm">
          环境：{settings?.environment || '服务端尚未配置 CORE_LOOP_ENVIRONMENT'}。首次启用时记录采集起点；账号默认不计入，需明确分类。
        </p>
        <AdminButton
          variant="primary"
          disabled={!settings || saving || (!settings.enabled && !settings.environment)}
          onClick={() => void toggleCollection()}
        >
          {settings?.enabled ? '停用统计' : '启用统计'}
        </AdminButton>
      </Section>

      <Section title="账号分类">
        <p className="text-muted-foreground text-sm">使用用户管理页中的 ID。分类会记录审计日志，并影响历史周的重算结果。</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="core-loop-user-id">用户 ID</Label>
            <AdminInput
              id="core-loop-user-id"
              aria-label="用户 ID"
              placeholder="用户 ID"
              value={userId}
              onChange={(event) => {
                actorSequence.current++;
                setUserId(event.target.value);
                setActor(null);
              }}
            />
          </div>
          <AdminButton onClick={() => void readActor()}>读取分类</AdminButton>
        </div>
        {actor && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/80 pt-3">
            <span className="text-muted-foreground text-sm">
              {actor.actorKey} · 已保存：{kinds[actor.kind]}
            </span>
            <AdminSelect aria-label="账号分类" value={kind} onChange={(event) => setKind(event.target.value)}>
              {Object.entries(kinds).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </AdminSelect>
            <AdminButton variant="primary" disabled={saving} onClick={() => void saveActor()}>保存分类</AdminButton>
          </div>
        )}
      </Section>

      {report && (
        <Section title="受控核对明细">
          <p className="text-muted-foreground mb-3 text-sm">未计入的制作可能没有可确定的完成周。口径：{report.version}</p>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>制作 ID</TableHead>
                  <TableHead>用户标识</TableHead>
                  <TableHead>判定</TableHead>
                  <TableHead>完成时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.evaluations.map((item, index) => (
                  <TableRow key={`${item.productionId}-${index}`}>
                    <TableCell className="font-mono text-xs">{item.productionId}</TableCell>
                    <TableCell>{item.actorKey}</TableCell>
                    <TableCell>{labels[item.reason] || '待核对'}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{item.completedAt || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {report.detailsTruncated && (
            <p className="text-muted-foreground mt-3 text-xs">明细仅显示前 200 条，汇总仍基于全部记录。</p>
          )}
        </Section>
      )}
    </div>
  );
}