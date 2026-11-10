import { Link } from 'react-router';
import api from '../services/api';
import { useRemoteSection } from '../hooks/useRemoteSection';
import { PageHeader } from '../components/admin/PageHeader';
import { Section } from '../components/admin/Section';
import { EmptyState, TableContainer } from '../components/admin/ListPrimitives';
import { adminLink } from '../navigation/adminNavigation';
type Stats = {users:number;recipes:number;posts:number;ingredients?:number;inventory:number;kitchenwareCatalog?:number;kitchenware:number};
type Trend = {date:string;users:number;records:number;posts:number};
const loadStats=async()=>(await api.get<Stats>('/admin/stats')).data;
const loadTrends=async()=>(await api.get<Trend[]>('/admin/stats/trends')).data;
const series=[{key:'users',label:'新增用户',color:'#2d6a4f'},{key:'records',label:'饮食记录',color:'#2563eb'},{key:'posts',label:'社区动态',color:'#a16207'}] as const;
export default function Analytics(){
  const stats=useRemoteSection(loadStats);const trends=useRemoteSection(loadTrends);
  const rows=trends.data || [];const max=Math.max(1,...rows.flatMap(row=>[row.users,row.records,row.posts]));
  const metrics=stats.data ? [
    {label:'用户',value:stats.data.users,path:'/admin/users'},
    {label:'食谱',value:stats.data.recipes,path:'/admin/recipes'},
    {label:'社区动态',value:stats.data.posts,path:'/admin/community'},
    {label:'食材库',value:stats.data.ingredients,path:'/admin/ingredients'},
    {label:'官方厨具',value:stats.data.kitchenwareCatalog,path:'/admin/kitchenware'},
    {label:'用户厨具',value:stats.data.kitchenware,path:'/admin/kitchenware'},
  ]:[];
  return <div className="admin-stack"><PageHeader title="数据概览" description="查看业务规模与每日新增趋势。详细运营操作请进入对应业务页面。"/>
    <Section title="业务规模" state={stats}><div className="admin-metrics">{metrics.map(item=><Link key={item.label} className="admin-metric" to={adminLink(item.path).to}><span>{item.label}</span><strong>{item.value === undefined ? '—' : item.value.toLocaleString()}</strong></Link>)}</div></Section>
    <Section title="每日趋势" state={trends}>{rows.length ? <><div className="admin-actions mb-4">{series.map(s=><span key={s.key} style={{color:s.color}}>● {s.label}</span>)}</div><svg viewBox="0 0 840 260" role="img" aria-label="用户、饮食记录与社区动态的每日新增趋势；精确数值见下方表格" className="w-full"><title>每日新增趋势</title>{[0,.25,.5,.75,1].map(r=><g key={r}><line x1="45" y1={225-r*200} x2="820" y2={225-r*200} stroke="#e5e7eb"/><text x="4" y={230-r*200} fill="#64748b" fontSize="12">{Math.round(max*r)}</text></g>)}{series.map(s=><g key={s.key}><polyline fill="none" stroke={s.color} strokeWidth="2" points={rows.map((row,i)=>`${45+i*775/Math.max(1,rows.length-1)},${225-row[s.key]/max*200}`).join(' ')}/>{rows.map((row,i)=><circle key={row.date} cx={45+i*775/Math.max(1,rows.length-1)} cy={225-row[s.key]/max*200} r="3" fill={s.color}><title>{row.date} {s.label}：{row[s.key]}</title></circle>)}</g>)}<text x="45" y="250" fill="#64748b" fontSize="12">{rows[0].date}</text><text x="820" y="250" textAnchor="end" fill="#64748b" fontSize="12">{rows.at(-1)?.date}</text></svg><details className="mt-4"><summary className="cursor-pointer text-primary">查看每日数值</summary><TableContainer><table><thead><tr><th>日期</th>{series.map(s=><th key={s.key}>{s.label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.date}><td>{row.date}</td>{series.map(s=><td key={s.key}>{row[s.key]}</td>)}</tr>)}</tbody></table></TableContainer></details></>:<EmptyState>暂无趋势数据。</EmptyState>}</Section>
  </div>;
}
