import { Link } from 'react-router'
import {
  Apple,
  BookOpen,
  CookingPot,
  MessageSquare,
  Users,
  Bell,
  Sparkles,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Activity,
  ShieldCheck,
  CircleAlert,
  Clock3,
  ArrowUpRight,
} from 'lucide-react'
import { EmptyState, Section, StatusBadge } from '@/components/admin'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import api from '@/services/api'
import { useRemoteSection } from '@/hooks/useRemoteSection'
import { failureRunStatuses, waitingRunStatuses } from './dashboardRunStatuses'
import { adminLink } from '@/navigation/adminNavigation'

interface Task { id: number | string; title: string; note: string }
interface Queue { items: Task[]; total?: number }

const queueIcons: Record<string, typeof Apple> = {
  '/admin/ingredients': Apple,
  '/admin/recipes': BookOpen,
  '/admin/kitchenware-mapping-reviews': CookingPot,
  '/admin/feedback': MessageSquare,
}

const quickActions = [
  { path: '/admin/recipes', icon: BookOpen },
  { path: '/admin/users', icon: Users },
  { path: '/admin/feedback', icon: MessageSquare },
  { path: '/admin/notifications', icon: Bell },
]

const queues: { title: string; path: string; query: Record<string, string>; load: () => Promise<Queue> }[] = [
  {
    title: '待审食材',
    path: '/admin/ingredients',
    query: { tab: 'ugc' },
    load: async (): Promise<Queue> => {
      const { data } = await api.get('/admin/stats/recent')
      return {
        items: data.pendingFoods.map((item: { id: number; name: string; author_name: string }) => ({
          id: item.id,
          title: item.name,
          note: `提交人：${item.author_name || '用户'}`,
        })),
      }
    },
  },
  {
    title: '待审食谱',
    path: '/admin/recipes',
    query: { reviewStatus: 'pending' },
    load: async (): Promise<Queue> => {
      const { data } = await api.get('/admin/recipes', { params: { reviewStatus: 'pending', pageSize: 5 } })
      return {
        total: data.total,
        items: data.items.map((item: { id: number; title: string; author_username: string }) => ({
          id: item.id,
          title: item.title,
          note: `提交人：${item.author_username || '用户'}`,
        })),
      }
    },
  },
  {
    title: '厨具映射审核',
    path: '/admin/kitchenware-mapping-reviews',
    query: { status: 'pending' },
    load: async (): Promise<Queue> => {
      const { data } = await api.get('/admin/kitchenware/mapping-reviews', { params: { status: 'pending' } })
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.reviews) ? data.reviews : []
      return {
        items: items.slice(0, 5).map((item: { id: number; raw_name: string; source_type: string }) => ({
          id: item.id,
          title: item.raw_name,
          note: `来源：${item.source_type}`,
        })),
      }
    },
  },
  ...(['received', 'processing'] as const).map((status) => ({
    title: status === 'received' ? '新收到的反馈' : '处理中的反馈',
    path: '/admin/feedback',
    query: { status },
    load: async (): Promise<Queue> => {
      const { data } = await api.get('/feedback/admin', { params: { status, limit: 5 } })
      return {
        items: data.items.map((item: { id: number; content: string; userId: number }) => ({
          id: item.id,
          title: item.content,
          note: `反馈 #${item.id} · 用户 ${item.userId}`,
        })),
      }
    },
  })),
]

function QueueSection({ queue }: { queue: (typeof queues)[number] }) {
  const state = useRemoteSection(queue.load)
  const link = adminLink(queue.path, queue.query)
  const Icon = queueIcons[queue.path]
  return (
    <Section
      title={queue.title}
      icon={<Icon size={18} />}
      state={state}
      action={
        <Button asChild variant="ghost" size="sm">
          <Link to={link.to}>查看全部 →</Link>
        </Button>
      }
    >
      <p className="text-muted-foreground text-xs">
        {state.data?.total !== undefined ? `共 ${state.data.total} 条待处理` : '近期待处理 · 最多展示 5 条'}
      </p>
      {state.data?.items.length ? (
        <ul className="divide-border divide-y">
          {state.data.items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <Link to={link.to} className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-1 py-2.5 transition-colors">
                <span className="min-w-0">
                  <strong className="text-foreground line-clamp-2 text-sm font-medium">{item.title}</strong>
                  <small className="text-muted-foreground mt-0.5 block text-xs">{item.note}</small>
                </span>
                <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>当前没有该类待处理事项。</EmptyState>
      )}
    </Section>
  )
}

const loadRuns = async () =>
  (await api.get<{ statusCounts: { status: string; count: number }[] }>('/admin/agent-runs', { params: { range: '7d', pageSize: 1 } })).data
const loadAudit = async () =>
  (await api.get<{ items: { id: number; adminName: string; summary: string; createdAt: string }[] }>('/admin/audit-logs', { params: { pageSize: 5 } })).data

export default function Dashboard() {
  const runs = useRemoteSection(loadRuns)
  const audit = useRemoteSection(loadAudit)
  const counts = Object.fromEntries((runs.data?.statusCounts || []).map((item) => [item.status, item.count]))
  const today = new Date()

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden py-0">
        <CardContent className="from-primary/8 via-card to-card grid gap-5 bg-gradient-to-br p-5 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-3">
            <Badge variant="secondary" className="tracking-wide uppercase">工作台 / Daily Overview</Badge>
            <div className="space-y-1">
              <h1 className="text-foreground flex items-center gap-2 text-2xl font-semibold tracking-tight">
                今日运营概览
                <Sparkles className="text-primary size-5" aria-hidden="true" />
              </h1>
              <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
                让内容有序，让服务有温度。这里汇集了今天值得关注的审核、反馈与运行状态。
              </p>
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              <span>{today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <Link to={adminLink('/admin/analytics').to}>查看数据概览 →</Link>
              </Button>
            </div>
          </div>
          <div className="bg-card/80 hidden w-28 rounded-2xl p-3 text-center ring-1 ring-foreground/10 md:block" aria-hidden="true">
            <div className="text-muted-foreground text-xs">{today.toLocaleDateString('zh-CN', { month: 'long' })}</div>
            <div className="text-foreground text-3xl font-semibold tracking-tight">{String(today.getDate()).padStart(2, '0')}</div>
            <div className="text-muted-foreground text-xs">{today.toLocaleDateString('zh-CN', { weekday: 'long' })}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickActions.map(({ path, icon: Icon }) => {
          const item = adminLink(path)
          return (
            <Link key={path} to={item.to} className="group">
              <Card className="hover:bg-muted/30 py-3 transition-colors">
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                  <ChevronRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="运行异常 · 近 7 天" icon={<Activity size={17} />} state={runs}>
          <div className="grid gap-2 sm:grid-cols-2">
            {failureRunStatuses.map((item) => (
              <Link
                key={item.status}
                to={adminLink('/admin/agent-runs', { range: '7d', status: item.status }).to}
                className="admin-metric is-danger border-destructive/15 bg-destructive/5 hover:bg-destructive/10 rounded-xl border p-3 transition-colors"
              >
                <span className="admin-metric-label text-destructive flex items-center gap-1.5 text-xs font-medium">
                  <CircleAlert className="size-3.5" aria-hidden="true" />
                  {item.label}
                </span>
                <strong className="text-foreground mt-1 block text-2xl font-semibold tracking-tight">{counts[item.status] ?? 0}</strong>
                <small className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                  排查异常 <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </small>
              </Link>
            ))}
          </div>
        </Section>
        <Section title="等待用户继续 · 近 7 天" icon={<Users size={17} />} state={runs}>
          <div className="grid gap-2 sm:grid-cols-2">
            {waitingRunStatuses.map((item) => (
              <Link
                key={item.status}
                to={adminLink('/admin/agent-runs', { range: '7d', status: item.status }).to}
                className="admin-metric bg-muted/40 hover:bg-muted/70 rounded-xl p-3 transition-colors ring-1 ring-foreground/5"
              >
                <span className="admin-metric-label text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  {item.label}
                </span>
                <strong className="text-foreground mt-1 block text-2xl font-semibold tracking-tight">{counts[item.status] ?? 0}</strong>
                <small className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                  查看记录 <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </small>
              </Link>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">不是运行失败，等待用户在应用中补充输入或确认后继续。</p>
        </Section>
      </div>

      <section aria-label="待处理事项" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
              <ClipboardList className="size-4" aria-hidden="true" />
              待处理事项
            </h2>
            <p className="text-muted-foreground text-xs">逐项读取，优先关注人工审核</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">{queues.map((queue) => <QueueSection key={queue.title} queue={queue} />)}</div>
      </section>

      <Section title="最近管理操作" icon={<ShieldCheck size={17} />} state={audit}>
        {audit.data?.items?.length ? (
          <ul className="divide-border divide-y">
            {audit.data.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.summary}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">{item.adminName}</p>
                </div>
                <StatusBadge tone="neutral">{new Date(item.createdAt).toLocaleString('zh-CN')}</StatusBadge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>暂无审计记录。</EmptyState>
        )}
      </Section>
    </div>
  )
}
