import { Link } from 'react-router';
import { Apple, BookOpen, CookingPot, MessageSquare, Users, Bell, Sparkles, CalendarDays, ChevronRight, ClipboardList, Activity, ShieldCheck } from 'lucide-react';
import api from '../services/api';
import { useRemoteSection } from '../hooks/useRemoteSection';
import { Section } from '../components/admin/Section';
import { EmptyState } from '../components/admin/ListPrimitives';
import { StatusBadge } from '../components/admin/StatusBadge';
import { failureRunStatuses, waitingRunStatuses } from './dashboardRunStatuses';
import { adminLink } from '../navigation/adminNavigation';
interface Task { id: number | string; title: string; note: string }
interface Queue { items: Task[]; total?: number }
const queueIcons: Record<string, typeof Apple> = {
  '/admin/ingredients': Apple,
  '/admin/recipes': BookOpen,
  '/admin/kitchenware-mapping-reviews': CookingPot,
  '/admin/feedback': MessageSquare,
};
const quickActions = [
  { path: '/admin/recipes', icon: BookOpen },
  { path: '/admin/users', icon: Users },
  { path: '/admin/feedback', icon: MessageSquare },
  { path: '/admin/notifications', icon: Bell },
];
const queues: {title:string;path:string;query:Record<string,string>;load:()=>Promise<Queue>}[] = [
  { title: '待审食材', path: '/admin/ingredients', query: { tab: 'ugc' }, load: async (): Promise<Queue> => {
    const {data} = await api.get('/admin/stats/recent');
    return {items: data.pendingFoods.map((item: {id:number;name:string;author_name:string})=>({id:item.id,title:item.name,note:`提交人：${item.author_name || '用户'}`}))};
  } },
  { title: '待审食谱', path: '/admin/recipes', query: { reviewStatus: 'pending' }, load: async (): Promise<Queue> => {
    const {data} = await api.get('/admin/recipes', {params:{reviewStatus:'pending',pageSize:5}});
    return {total:data.total,items:data.items.map((item:{id:number;title:string;author_username:string})=>({id:item.id,title:item.title,note:`提交人：${item.author_username || '用户'}`}))};
  } },
  { title: '厨具映射审核', path: '/admin/kitchenware-mapping-reviews', query: { status: 'pending' }, load: async (): Promise<Queue> => {
    const {data} = await api.get('/admin/kitchenware/mapping-reviews',{params:{status:'pending'}});
    return {items:data.items.slice(0,5).map((item:{id:number;raw_name:string;source_type:string})=>({id:item.id,title:item.raw_name,note:`来源：${item.source_type}`}))};
  } },
  ...(['received','processing'] as const).map(status => ({ title: status === 'received' ? '新收到的反馈' : '处理中的反馈',path:'/admin/feedback',query:{status},load:async ():Promise<Queue>=>{
    const {data} = await api.get('/feedback/admin',{params:{status,limit:5}});
    return {items:data.items.map((item:{id:number;content:string;userId:number})=>({id:item.id,title:item.content,note:`反馈 #${item.id} · 用户 ${item.userId}`}))};
  } })),
];
function QueueSection({ queue }: { queue: typeof queues[number] }) {
  const state = useRemoteSection(queue.load); const link = adminLink(queue.path,queue.query);
  const Icon = queueIcons[queue.path];
  return <Section title={queue.title} icon={<Icon size={19} />} state={state} action={<Link to={link.to}>查看全部 →</Link>}>
    <p className="admin-muted">{state.data?.total !== undefined ? `共 ${state.data.total} 条待处理` : '近期待处理 · 最多展示 5 条'}</p>
    {state.data?.items.length ? <ul className="admin-task-list">{state.data.items.slice(0,5).map(item=><li key={item.id}><Link to={link.to}><span className="admin-task-text"><strong className="line-clamp-2">{item.title}</strong><small>{item.note}</small></span><span aria-hidden="true">→</span></Link></li>)}</ul> : <EmptyState>当前没有该类待处理事项。</EmptyState>}
  </Section>;
}
const loadRuns = async () => (await api.get<{statusCounts:{status:string;count:number}[]}>('/admin/agent-runs',{params:{range:'7d',pageSize:1}})).data;
const loadAudit = async () => (await api.get<{items:{id:number;adminName:string;summary:string;createdAt:string}[]}>('/admin/audit-logs',{params:{pageSize:5}})).data;
export default function Dashboard() {
  const runs = useRemoteSection(loadRuns); const audit = useRemoteSection(loadAudit);
  const counts = Object.fromEntries((runs.data?.statusCounts || []).map(item=>[item.status,item.count]));
  return <div className="admin-stack">
    <section className="admin-overview" aria-label="工作台概览">
      <div className="admin-overview-label">Control center · 01 / Overview</div>
      <h1>今日运营概览 <Sparkles size={24} aria-hidden="true" /></h1>
      <p>关注用户、内容资产与 AI 服务状态，优先处理需要人工介入的事项。</p>
      <div className="admin-overview-meta">
        <CalendarDays size={15} aria-hidden="true" />
        <span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
        <Link to={adminLink('/admin/analytics').to} className="admin-link ml-2">查看数据概览 →</Link>
      </div>
      <nav className="admin-quick-routes" aria-label="常用入口">
        {quickActions.map(({ path, icon: Icon }) => {
          const item = adminLink(path);
          return <Link key={path} to={item.to} className="admin-quick-route">
            <Icon size={20} aria-hidden="true" /><span>{item.label}</span><ChevronRight size={16} aria-hidden="true" />
          </Link>;
        })}
      </nav>
    </section>
    <div><h2 className="admin-section-title"><ClipboardList size={21} aria-hidden="true" />待处理事项</h2><div className="admin-section-grid">{queues.map(queue=><QueueSection key={queue.title} queue={queue}/>)}</div></div>
    <Section title="运行异常 · 近 7 天" icon={<Activity size={19} />} state={runs}><div className="admin-metrics">{failureRunStatuses.map(item=><Link key={item.status} to={adminLink('/admin/agent-runs',{range:'7d',status:item.status}).to} className="admin-metric"><span>{item.label}</span><strong>{counts[item.status] ?? 0}</strong><small>排查异常 →</small></Link>)}</div></Section>
    <Section title="等待用户继续 · 近 7 天" icon={<Users size={19} />} state={runs}><div className="admin-metrics">{waitingRunStatuses.map(item=><Link key={item.status} to={adminLink('/admin/agent-runs',{range:'7d',status:item.status}).to} className="admin-metric"><span>{item.label}</span><strong>{counts[item.status] ?? 0}</strong><small>查看记录 →</small></Link>)}</div><p className="admin-muted mt-4">这些任务不是运行失败，需要由用户在应用中补充输入或确认后继续。</p></Section>
    <Section title="最近管理操作" icon={<ShieldCheck size={19} />} state={audit} action={<Link to={adminLink('/admin/security').to}>查看全部 →</Link>}>{audit.data?.items.length ? <ul className="admin-task-list">{audit.data.items.slice(0,5).map(item=><li key={item.id}><div className="admin-task-row"><span className="admin-task-text"><strong>{item.summary}</strong><small>{item.adminName} · {new Date(item.createdAt).toLocaleString('zh-CN')}</small></span><StatusBadge>已记录</StatusBadge></div></li>)}</ul>:<EmptyState>暂无管理操作记录。</EmptyState>}</Section>
  </div>;
}
