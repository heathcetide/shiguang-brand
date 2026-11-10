import axios from 'axios';
import { useEffect, useState } from 'react';
import { Award, Plus, RefreshCcw, Save, Trash2, TrendingUp } from 'lucide-react';
import api from '../services/api';

type Level = { level: number; title: string; requiredXp: number };
type Rule = {
  levels: Level[];
  xp: {
    dietRecord: number;
    streakDay: number;
    recipeFavorite: number;
    communityPost: number;
    follower: number;
    dailyCheckIn: number;
  };
};

const DEFAULT_RULE: Rule = {
  levels: [
    { level: 1, title: '健康新芽', requiredXp: 0 },
    { level: 2, title: '轻食探索者', requiredXp: 150 },
    { level: 3, title: '健康达人', requiredXp: 450 },
    { level: 4, title: '营养生活家', requiredXp: 900 },
    { level: 5, title: '食光大师', requiredXp: 1800 },
  ],
  xp: { dietRecord: 10, streakDay: 15, recipeFavorite: 5, communityPost: 30, follower: 20, dailyCheckIn: 5 },
};

const XP_FIELDS: Array<{ key: keyof Rule['xp']; label: string; description: string }> = [
  { key: 'dietRecord', label: '饮食记录', description: '每新增一条饮食记录' },
  { key: 'streakDay', label: '连续记录', description: '从今天起连续记录的每一天' },
  { key: 'recipeFavorite', label: '菜谱收藏', description: '每个当前收藏的菜谱' },
  { key: 'communityPost', label: '社区发帖', description: '每篇未删除的社区帖子' },
  { key: 'follower', label: '获得粉丝', description: '每位当前粉丝' },
  { key: 'dailyCheckIn', label: '每日签到', description: '每天首次签到，重复签到不奖励' },
];

function cloneRule(rule: Rule): Rule {
  return { levels: rule.levels.map((item) => ({ ...item })), xp: { ...rule.xp } };
}

function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string; details?: Array<{ message?: string }> } | undefined;
    return data?.details?.[0]?.message || data?.error || '保存失败，请稍后重试';
  }
  return '保存失败，请稍后重试';
}

export default function UserLevelRule() {
  const [rule, setRule] = useState<Rule>(cloneRule(DEFAULT_RULE));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadRule = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const { data } = await api.get<Rule>('/admin/user-level-rule');
      setRule(cloneRule(data));
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRule(); }, []);

  const updateLevel = (index: number, patch: Partial<Level>) => {
    setRule((current) => ({
      ...current,
      levels: current.levels.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  };

  const addLevel = () => {
    setRule((current) => {
      if (current.levels.length >= 20) return current;
      const previous = current.levels[current.levels.length - 1];
      return {
        ...current,
        levels: [...current.levels, {
          level: current.levels.length + 1,
          title: `成长等级 ${current.levels.length + 1}`,
          requiredXp: previous.requiredXp + Math.max(100, previous.requiredXp),
        }],
      };
    });
  };

  const removeLevel = (index: number) => {
    setRule((current) => ({
      ...current,
      levels: current.levels.filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({ ...item, level: itemIndex + 1 })),
    }));
  };

  const validationError = (() => {
    if (rule.levels.length < 2) return '至少保留两个等级';
    for (let index = 0; index < rule.levels.length; index += 1) {
      const item = rule.levels[index];
      if (!item.title.trim()) return `V${item.level} 的称号不能为空`;
      if (!Number.isInteger(item.requiredXp) || item.requiredXp < 0) return `V${item.level} 的 XP 门槛必须是非负整数`;
      if (index === 0 && item.requiredXp !== 0) return 'V1 的 XP 门槛必须为 0';
      if (index > 0 && item.requiredXp <= rule.levels[index - 1].requiredXp) return `V${item.level} 的 XP 门槛必须高于前一级`;
    }
    if (Object.values(rule.xp).some((value) => !Number.isInteger(value) || value < 0)) return '行为 XP 必须是非负整数';
    return null;
  })();

  const save = async () => {
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload: Rule = {
        levels: rule.levels.map((item) => ({ ...item, title: item.title.trim() })),
        xp: { ...rule.xp },
      };
      const { data } = await api.put<{ rule: Rule }>('/admin/user-level-rule', payload);
      setRule(cloneRule(data.rule));
      setMessage({ type: 'success', text: '等级规则已保存，所有用户的等级与经验已按新规则实时计算。' });
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center text-sm text-text-muted">正在加载等级规则…</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary"><Award size={22} /><span className="text-sm font-semibold">用户成长体系</span></div>
          <h1 className="mt-2 text-3xl font-bold text-text-main">账户等级规则</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">配置行为经验、等级称号和升级门槛。保存后会立即影响所有用户，已有人工经验修正继续保留。</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setRule(cloneRule(DEFAULT_RULE)); setMessage(null); }} className="flex items-center gap-2 rounded-xl border border-background-alt bg-white px-4 py-2.5 text-sm font-medium text-text-main hover:bg-background-alt"><RefreshCcw size={16} />载入默认值</button>
          <button type="button" onClick={() => void save()} disabled={saving || Boolean(validationError)} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><Save size={16} />{saving ? '保存中…' : '保存并生效'}</button>
        </div>
      </div>

      {message ? <div className={`rounded-2xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{message.text}</div> : null}
      {validationError ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">当前配置尚不能保存：{validationError}</div> : null}

      <section className="rounded-3xl border border-background-alt bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2.5 text-primary"><TrendingUp size={20} /></div><div><h2 className="font-semibold text-text-main">行为经验</h2><p className="mt-0.5 text-xs text-text-muted">设为 0 可关闭对应行为奖励</p></div></div>
        <div className="mt-5 overflow-hidden rounded-2xl border border-background-alt">
          <div className="grid grid-cols-[minmax(140px,220px)_minmax(220px,1fr)_minmax(150px,220px)] gap-3 bg-background-alt/70 px-4 py-3 text-xs font-semibold text-text-muted">
            <span>行为</span>
            <span>计算说明</span>
            <span>单次奖励</span>
          </div>
          {XP_FIELDS.map((field) => (
            <label key={field.key} className="grid grid-cols-[minmax(140px,220px)_minmax(220px,1fr)_minmax(150px,220px)] items-center gap-3 border-t border-background-alt px-4 py-3 first:border-t-0">
              <span className="text-sm font-semibold text-text-main">{field.label}</span>
              <span className="text-xs leading-5 text-text-muted">{field.description}</span>
              <span className="flex items-center gap-2"><input type="number" min={0} max={10000} step={1} value={rule.xp[field.key]} onChange={(event) => setRule((current) => ({ ...current, xp: { ...current.xp, [field.key]: Number(event.target.value) } }))} className="w-full rounded-xl border border-background-alt bg-background/40 px-3 py-2 text-right text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20" /><span className="text-xs font-medium text-text-muted">XP</span></span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-background-alt bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-text-main">等级与升级门槛</h2><p className="mt-1 text-xs text-text-muted">门槛为累计 XP，必须从 0 开始并严格递增，最多 20 级。</p></div><button type="button" onClick={addLevel} disabled={rule.levels.length >= 20} className="flex items-center gap-2 rounded-xl border border-primary/20 px-3.5 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-40"><Plus size={16} />增加等级</button></div>
        <div className="mt-5 overflow-hidden rounded-2xl border border-background-alt">
          <div className="grid grid-cols-[72px_minmax(160px,1fr)_minmax(150px,220px)_48px] gap-3 bg-background-alt/70 px-4 py-3 text-xs font-semibold text-text-muted"><span>等级</span><span>称号</span><span>累计 XP 门槛</span><span /></div>
          {rule.levels.map((item, index) => (
            <div key={item.level} className="grid grid-cols-[72px_minmax(160px,1fr)_minmax(150px,220px)_48px] items-center gap-3 border-t border-background-alt px-4 py-3 first:border-t-0">
              <span className="font-bold text-primary">V{item.level}</span>
              <input value={item.title} maxLength={20} onChange={(event) => updateLevel(index, { title: event.target.value })} className="rounded-xl border border-background-alt bg-background/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
              <div className="flex items-center gap-2"><input type="number" min={0} step={1} disabled={index === 0} value={item.requiredXp} onChange={(event) => updateLevel(index, { requiredXp: Number(event.target.value) })} className="w-full rounded-xl border border-background-alt bg-background/40 px-3 py-2 text-right text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20 disabled:text-text-muted" /><span className="text-xs text-text-muted">XP</span></div>
              <button type="button" title="删除等级" aria-label={`删除 V${item.level}`} disabled={index === 0 || rule.levels.length <= 2} onClick={() => removeLevel(index)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-25"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">说明：经验并非一次性余额，而是由饮食记录、连续记录、收藏、帖子、粉丝、每日签到及人工修正实时计算。因此修改规则可能让用户立即升级或降级。</div>
    </div>
  );
}
