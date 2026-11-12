import { EmptyState, PageHeader, Section, TableContainer } from '../components/admin';
import { Link } from 'react-router';
import api from '../services/api';
import { useRemoteSection } from '../hooks/useRemoteSection';
import { adminLink } from '../navigation/adminNavigation';

type Stats = {
  users: number;
  recipes: number;
  posts: number;
  ingredients?: number;
  inventory: number;
  kitchenwareCatalog?: number;
  kitchenware: number;
};

type Trend = {
  date: string;
  users: number;
  records: number;
  posts: number;
  comments?: number;
  ingredients?: number;
  recipes?: number;
  kitchenware?: number;
};

const loadStats = async () => (await api.get<Stats>('/admin/stats')).data;
const loadTrends = async () => (await api.get<Trend[]>('/admin/stats/trends', { params: { days: 30 } })).data;

const series = [
  { key: 'users', label: '新增用户', color: '#2d6a4f' },
  { key: 'records', label: '饮食记录', color: '#2563eb' },
  { key: 'posts', label: '社区动态', color: '#a16207' },
  { key: 'comments', label: '社区评论', color: '#7c3aed' },
] as const;

function sum(rows: Trend[], key: keyof Trend) {
  return rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
}

export default function Analytics() {
  const stats = useRemoteSection(loadStats);
  const trends = useRemoteSection(loadTrends);
  const rows = trends.data || [];
  // Min–max per series: seed data often sits in a narrow band (e.g. 80–143). Scaling to max alone
  // keeps the line near the top and looks "too flat"; stretch each series across its own range.
  const seriesRange = Object.fromEntries(
    series.map((s) => {
      const values = rows.map((row) => Number(row[s.key]) || 0);
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const span = Math.max(1, max - min);
      return [s.key, { min, max, span }];
    }),
  ) as Record<(typeof series)[number]['key'], { min: number; max: number; span: number }>;
  const metrics = stats.data
    ? [
        { label: '用户', value: stats.data.users, path: '/admin/users' },
        { label: '食谱', value: stats.data.recipes, path: '/admin/recipes' },
        { label: '社区动态', value: stats.data.posts, path: '/admin/community' },
        { label: '食材库', value: stats.data.ingredients, path: '/admin/ingredients' },
        { label: '官方厨具', value: stats.data.kitchenwareCatalog, path: '/admin/kitchenware' },
        { label: '用户厨具', value: stats.data.kitchenware, path: '/admin/kitchenware' },
        { label: '库存条目', value: stats.data.inventory, path: '/admin/ingredients' },
      ]
    : [];
  const period = rows.length
    ? [
        { label: '近 30 日新增用户', value: sum(rows, 'users') },
        { label: '近 30 日饮食记录', value: sum(rows, 'records') },
        { label: '近 30 日社区动态', value: sum(rows, 'posts') },
        { label: '近 30 日评论', value: sum(rows, 'comments') },
        { label: '近 30 日新增食谱', value: sum(rows, 'recipes') },
        { label: '近 30 日新增食材', value: sum(rows, 'ingredients') },
      ]
    : [];

  return (
    <div className="admin-stack">
      <PageHeader title="数据概览" description="查看业务规模与每日新增趋势。详细运营操作请进入对应业务页面。" />
      <Section title="业务规模" state={stats}>
        <div className="admin-metrics">
          {metrics.map((item) => (
            <Link key={item.label} className="admin-metric" to={adminLink(item.path).to}>
              <span>{item.label}</span>
              <strong>{item.value === undefined ? '—' : item.value.toLocaleString()}</strong>
            </Link>
          ))}
        </div>
      </Section>
      <Section title="近 30 日汇总" state={trends}>
        {period.length ? (
          <div className="admin-metrics">
            {period.map((item) => (
              <div key={item.label} className="admin-metric">
                <span>{item.label}</span>
                <strong>{item.value.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>暂无趋势数据。</EmptyState>
        )}
      </Section>
      <Section title="每日趋势" state={trends}>
        {rows.length ? (
          <>
            <div className="admin-actions mb-4">
              {series.map((s) => (
                <span key={s.key} style={{ color: s.color }}>● {s.label}</span>
              ))}
            </div>
            <svg
              viewBox="0 0 840 260"
              role="img"
              aria-label="用户、饮食记录、社区动态与评论的每日新增趋势；精确数值见下方表格"
              className="w-full"
            >
              <title>每日新增趋势</title>
              {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                <g key={r}>
                  <line x1="45" y1={225 - r * 200} x2="820" y2={225 - r * 200} stroke="#e5e7eb" />
                  <text x="4" y={230 - r * 200} fill="#64748b" fontSize="11">{`${Math.round(r * 100)}%`}</text>
                </g>
              ))}
              {series.map((s) => {
                const range = seriesRange[s.key];
                const yOf = (value: number) => 225 - ((value - range.min) / range.span) * 200;
                return (
                <g key={s.key}>
                  <polyline
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={rows
                      .map((row, i) => `${45 + (i * 775) / Math.max(1, rows.length - 1)},${yOf(Number(row[s.key]) || 0)}`)
                      .join(' ')}
                  />
                  {rows.map((row, i) => (
                    <circle
                      key={`${s.key}-${row.date}`}
                      cx={45 + (i * 775) / Math.max(1, rows.length - 1)}
                      cy={yOf(Number(row[s.key]) || 0)}
                      r="3.5"
                      fill={s.color}
                    >
                      <title>
                        {row.date} {s.label}：{Number(row[s.key]) || 0}
                        {range.max !== range.min ? `（区间 ${range.min}–${range.max}）` : ''}
                      </title>
                    </circle>
                  ))}
                </g>
              );})}
              <text x="45" y="18" fill="#64748b" fontSize="11">各指标按自身最小–最大拉伸，放大日间波动；绝对量见下方表格</text>
              <text x="45" y="250" fill="#64748b" fontSize="12">{rows[0].date}</text>
              <text x="820" y="250" textAnchor="end" fill="#64748b" fontSize="12">{rows.at(-1)?.date}</text>
            </svg>
            <details className="mt-4">
              <summary className="cursor-pointer text-primary">查看每日数值</summary>
              <TableContainer>
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      {series.map((s) => (
                        <th key={s.key}>{s.label}</th>
                      ))}
                      <th>新增食谱</th>
                      <th>新增食材</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        {series.map((s) => (
                          <td key={s.key}>{Number(row[s.key]) || 0}</td>
                        ))}
                        <td>{row.recipes || 0}</td>
                        <td>{row.ingredients || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            </details>
          </>
        ) : (
          <EmptyState>暂无趋势数据。</EmptyState>
        )}
      </Section>
    </div>
  );
}
