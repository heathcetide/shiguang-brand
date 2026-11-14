import axios from 'axios';
import { useEffect, useState } from 'react';
import { Award, Plus, RefreshCcw, Save, Trash2, TrendingUp } from 'lucide-react';
import api from '@/services/api';
import {
  AdminButton,
  AdminInput,
  EmptyState,
  PageHeader,
  Section,
  TableContainer,
} from '@/components/admin';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/utils/cn';

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
    { level: 5, title: '拾味大师', requiredXp: 1800 },
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

  useEffect(() => {
    void loadRule();
  }, []);

  const updateLevel = (index: number, patch: Partial<Level>) => {
    setRule((current) => ({
      ...current,
      levels: current.levels.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  };

  const addLevel = () => {
    setRule((current) => {
      if (current.levels.length >= 20) return current;
      const previous = current.levels[current.levels.length - 1];
      return {
        ...current,
        levels: [
          ...current.levels,
          {
            level: current.levels.length + 1,
            title: `成长等级 ${current.levels.length + 1}`,
            requiredXp: previous.requiredXp + Math.max(100, previous.requiredXp),
          },
        ],
      };
    });
  };

  const removeLevel = (index: number) => {
    setRule((current) => ({
      ...current,
      levels: current.levels
        .filter((_, itemIndex) => itemIndex !== index)
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

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <EmptyState>正在加载等级规则…</EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="账户等级规则"
        description="配置行为经验、等级称号和升级门槛。保存后会立即影响所有用户，已有人工经验修正继续保留。"
        actions={
          <>
            <AdminButton
              type="button"
              onClick={() => {
                setRule(cloneRule(DEFAULT_RULE));
                setMessage(null);
              }}
            >
              <RefreshCcw size={16} />
              载入默认值
            </AdminButton>
            <AdminButton
              type="button"
              variant="primary"
              onClick={() => void save()}
              disabled={saving || Boolean(validationError)}
            >
              <Save size={16} />
              {saving ? '保存中…' : '保存并生效'}
            </AdminButton>
          </>
        }
      />
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Award size={16} className="text-primary" aria-hidden />
        用户成长体系
      </p>

      {message ? (
        <p
          role={message.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            message.type === 'success'
              ? 'border-border bg-muted/50 text-foreground'
              : 'border-destructive/20 bg-destructive/10 text-destructive',
          )}
        >
          {message.text}
        </p>
      ) : null}
      {validationError ? (
        <p role="status" className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          当前配置尚不能保存：{validationError}
        </p>
      ) : null}

      <Section title="行为经验" icon={<TrendingUp size={18} />}>
        <p className="text-muted-foreground mb-3 text-xs">设为 0 可关闭对应行为奖励</p>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>行为</TableHead>
                <TableHead>计算说明</TableHead>
                <TableHead className="w-40 text-right">单次奖励</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {XP_FIELDS.map((field) => (
                <TableRow key={field.key}>
                  <TableCell className="font-medium">{field.label}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{field.description}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <AdminInput
                        type="number"
                        min={0}
                        max={10000}
                        step={1}
                        value={rule.xp[field.key]}
                        onChange={(event) =>
                          setRule((current) => ({
                            ...current,
                            xp: { ...current.xp, [field.key]: Number(event.target.value) },
                          }))
                        }
                        className="w-28 text-right"
                      />
                      <span className="text-muted-foreground text-xs">XP</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>

      <Section
        title="等级与升级门槛"
        action={
          <AdminButton type="button" onClick={addLevel} disabled={rule.levels.length >= 20}>
            <Plus size={16} />
            增加等级
          </AdminButton>
        }
      >
        <p className="text-muted-foreground mb-3 text-xs">门槛为累计 XP，必须从 0 开始并严格递增，最多 20 级。</p>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">等级</TableHead>
                <TableHead>称号</TableHead>
                <TableHead className="w-48">累计 XP 门槛</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rule.levels.map((item, index) => (
                <TableRow key={item.level}>
                  <TableCell>
                    <Badge variant="outline">V{item.level}</Badge>
                  </TableCell>
                  <TableCell>
                    <AdminInput
                      value={item.title}
                      maxLength={20}
                      onChange={(event) => updateLevel(index, { title: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <AdminInput
                        type="number"
                        min={0}
                        step={1}
                        disabled={index === 0}
                        value={item.requiredXp}
                        onChange={(event) => updateLevel(index, { requiredXp: Number(event.target.value) })}
                        className="w-28 text-right"
                      />
                      <span className="text-muted-foreground text-xs">XP</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <AdminButton
                      type="button"
                      title="删除等级"
                      aria-label={`删除 V${item.level}`}
                      disabled={index === 0 || rule.levels.length <= 2}
                      onClick={() => removeLevel(index)}
                      variant="danger"
                    >
                      <Trash2 size={16} />
                    </AdminButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>

      <p className="text-muted-foreground text-xs leading-5">
        说明：经验并非一次性余额，而是由饮食记录、连续记录、收藏、帖子、粉丝、每日签到及人工修正实时计算。因此修改规则可能让用户立即升级或降级。
      </p>
    </div>
  );
}