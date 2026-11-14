import { AdminButton, AdminField, AdminInput, AdminSelect, ConfirmDialog, DetailPanel, EmptyState, FilterBar, PageHeader, StatusBadge } from '@/components/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQueryState } from '@/hooks/useQueryState';
import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Search, User, ShieldAlert, BadgeCheck, Users as UsersIcon, Mail, Phone, Lock, Sparkles, UserX, UserCheck, HeartPulse, ShieldCheck, Pill, CookingPot, Target, Activity, RefreshCw } from 'lucide-react';
import api from '@/services/api';
import { createLatestRequest } from '@/utils/latestRequest';
import { cn } from '@/utils/cn';
import { getAvatarUrl } from '@/utils/avatar';
import { parseAdminUsers, type AdminUser as UserData } from '@/utils/adminResponses';

type AllergySeverity = 'mild' | 'moderate' | 'severe';
interface AdminHealthProfile {
  gender?: string | null;
  age?: number | null;
  height?: number | null;
  weight?: number | null;
  target_weight?: number | null;
  dietary_preference?: string;
  allergies?: Array<{ name: string; type: 'allergy' | 'intolerance'; severity: AllergySeverity }>;
  medications?: string;
  medical_conditions?: string[];
  medical_notes?: string;
  dietary_restrictions?: string[];
  disliked_foods?: string;
  kitchen_constraints?: {
    meal_time_minutes?: number | null;
    budget_per_meal?: number | null;
    cooking_level?: string | null;
    servings?: number | null;
    eating_out_frequency?: string | null;
  };
  nutrition_targets?: {
    calories_kcal?: number | null;
    protein_g?: number | null;
    salt_g?: number | null;
    sugar_g?: number | null;
    water_ml?: number | null;
    professional_advice?: string;
  };
  tracking_enabled?: boolean;
  updated_at?: string;
}

interface AdminHealthProfileResponse {
  user_id: number;
  profile: AdminHealthProfile | null;
  latest_tracking: {
    recorded_date: string;
    weight?: number | null;
    body_fat?: number | null;
    waist_cm?: number | null;
    blood_pressure_systolic?: number | null;
    blood_pressure_diastolic?: number | null;
    blood_glucose_mmol?: number | null;
    sleep_hours?: number | null;
    cycle_status?: string | null;
  } | null;
  tracking_count: number;
}

export default function Users() {
  const [accountSaving,setAccountSaving] = useState(false);
  const accountBusy = useRef(false);
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useQueryState<string>('q', '');
  const [roleFilter, setRoleFilter] = useQueryState<'all' | 'admin' | 'user' | 'expert' | 'disabled'>('role', 'all', ["all", "admin", "user", "expert", "disabled"]);

  const [detailTab, setDetailTab] = useState<'basic' | 'level' | 'health' | 'account'>('basic');
  const [loadError, setLoadError] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [credentialIdentifier, setCredentialIdentifier] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsMessage, setCredentialsMessage] = useState('');
  const [xpDelta, setXpDelta] = useState('');
  const [xpReason, setXpReason] = useState('');
  const [xpMessage, setXpMessage] = useState('');
  const [xpSaving, setXpSaving] = useState(false);
  const [healthProfileDetail, setHealthProfileDetail] = useState<AdminHealthProfileResponse | null>(null);
  const [healthProfileLoading, setHealthProfileLoading] = useState(false);
  const [healthProfileError, setHealthProfileError] = useState('');
  const healthProfileRequests = useRef(createLatestRequest());
  useEffect(() => () => healthProfileRequests.current.cancel(), []);

  const [confirmRoleModal, setConfirmRoleModal] = useState<{
    userId: number;
    currentRole: string;
  } | null>(null);

  const [confirmStatusModal, setConfirmStatusModal] = useState<{
    userId: number;
    currentDisabled: boolean;
  } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const pageSize = 50;

  useEffect(() => {
    void fetchUsers();
  }, []);

  const fetchUsers = async (cursor?: string) => {
    try {
      setLoading(true); setLoadError('');
      const res = await api.get<unknown>('/admin/users', {
        params: {
          pageSize,
          cursor,
        },
      });
      const parsed = parseAdminUsers(res.data);
      setUsers((current) =>
        cursor
          ? [...current, ...parsed.items.filter((item) => !current.some((existing) => existing.id === item.id))]
          : parsed.items,
      );
      setNextCursor(parsed.nextCursor);
    } catch {
      setLoadError('读取用户失败，请重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRole = async (id: number, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (accountBusy.current) return;
    accountBusy.current = true; setAccountSaving(true);
    try {
      await api.put(`/admin/users/${id}/role`, { role: newRole });
      setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
      if (selectedUser && selectedUser.id === id) {
        setSelectedUser({ ...selectedUser, role: newRole });
      }
      setConfirmRoleModal(null);
    } catch (err: any) {
      const msg = err.response?.data?.error || '操作失败';
      alert(msg);
    } finally { accountBusy.current = false; setAccountSaving(false); }
  };

  const handleToggleExpert = async (id: number, currentValue: boolean) => {
    try {
      const nextValue = !currentValue;
      await api.put(`/admin/users/${id}/expert`, { is_verified_expert: nextValue });
      setUsers(current => current.map(user => user.id === id ? { ...user, is_verified_expert: nextValue } : user));
      setSelectedUser(current => current?.id === id ? { ...current, is_verified_expert: nextValue } : current);
    } catch (err) {
      console.error('Error toggling expert verification:', err);
    }
  };

  const handleToggleDisabled = async (id: number, currentDisabled: boolean) => {
    if (accountBusy.current) return;
    accountBusy.current = true; setAccountSaving(true);
    try {
      const nextDisabled = !currentDisabled;
      await api.put(`/admin/users/${id}/status`, { is_disabled: nextDisabled });
      setUsers(current => current.map(u => u.id === id ? { ...u, is_disabled: nextDisabled } : u));
      if (selectedUser && selectedUser.id === id) {
        setSelectedUser({ ...selectedUser, is_disabled: nextDisabled });
      }
      setConfirmStatusModal(null);
    } catch (err: any) {
      const msg = err.response?.data?.error || '更新账号状态失败';
      alert(msg);
    } finally { accountBusy.current = false; setAccountSaving(false); }
  };

  const fetchHealthProfileDetail = async (userId: number) => {
    const request = healthProfileRequests.current.begin();
    try {
      setHealthProfileLoading(true);
      setHealthProfileError('');
      const response = await api.get(`/admin/users/${userId}/health-profile`, { signal: request.signal });
      if (!request.isLatest()) return;
      const raw = response.data as AdminHealthProfileResponse & { userId?: number };
      const detail: AdminHealthProfileResponse = {
        ...raw,
        user_id: raw.user_id ?? raw.userId ?? userId,
        profile: raw.profile && Object.keys(raw.profile).length > 0 ? raw.profile : null,
        latest_tracking: raw.latest_tracking ?? null,
        tracking_count: raw.tracking_count ?? 0,
      };
      if (detail.user_id !== userId) throw new Error('Health profile identity mismatch');
      setHealthProfileDetail(detail);
    } catch (error) {
      if (!request.isLatest()) return;
      const message = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      setHealthProfileDetail(null);
      setHealthProfileError(message || '健康与饮食档案加载失败');
    } finally {
      if (request.isLatest()) setHealthProfileLoading(false);
    }
  };

  const resetHealthProfile = () => {
    healthProfileRequests.current.cancel();
    setHealthProfileDetail(null);
    setHealthProfileError('');
    setHealthProfileLoading(false);
  };

  const closeUserDetail = () => {
    resetHealthProfile();
    setSelectedUser(null);
  };

  const openUserDetail = (user: UserData) => {
    resetHealthProfile();
    setSelectedUser(user);
    setDetailTab('basic');
    setCredentialIdentifier(user.email || user.phone || user.username);
    setResetPassword('');
    setCredentialsMessage('');
    setXpDelta('');
    setXpReason('');
    setXpMessage('');
  };

  const handleAdjustXp = async () => {
    if (!selectedUser) return;
    const delta = Number(xpDelta);
    if (!Number.isInteger(delta) || delta === 0 || !xpReason.trim()) { setXpMessage('请填写非 0 的整数经验值及调整原因'); return; }
    try {
      setXpSaving(true); setXpMessage('');
      const res = await api.post(`/admin/users/${selectedUser.id}/level-adjustments`, { xp_delta: delta, reason: xpReason.trim() });
      const level = res.data.level;
      setUsers(current => current.map(item => item.id === selectedUser.id ? { ...item, level } : item));
      setSelectedUser(current => current ? { ...current, level } : current);
      setXpDelta(''); setXpReason(''); setXpMessage('经验已调整，操作已写入审计日志');
    } catch (error: any) { setXpMessage(error.response?.data?.error || '调整失败'); }
    finally { setXpSaving(false); }
  };

  const handleSaveCredentials = async () => {
    if (!selectedUser || selectedUser.role === 'admin') return;
    const identifier = credentialIdentifier.trim().toLowerCase();
    const currentIdentifier = (selectedUser.email || selectedUser.phone || selectedUser.username).toLowerCase();
    if (!identifier) {
      setCredentialsMessage('请输入邮箱或手机号');
      return;
    }
    if (!resetPassword && identifier === currentIdentifier) {
      setCredentialsMessage('未检测到需要保存的改动');
      return;
    }
    try {
      setCredentialsSaving(true);
      setCredentialsMessage('');
      const res = await api.put(`/admin/users/${selectedUser.id}/credentials`, {
        ...(identifier === currentIdentifier ? {} : { identifier }),
        ...(resetPassword ? { newPassword: resetPassword } : {}),
      });
      const updated = res.data.user as Pick<UserData, 'username' | 'email' | 'phone'>;
      setUsers(current => current.map(user => user.id === selectedUser.id ? { ...user, ...updated } : user));
      setSelectedUser(current => current?.id === selectedUser.id ? { ...current, ...updated } : current);
      setCredentialIdentifier(updated.email || updated.phone || updated.username);
      setResetPassword('');
      setCredentialsMessage('登录信息已保存');
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      setCredentialsMessage(message || '保存失败，请稍后重试');
    } finally {
      setCredentialsSaving(false);
    }
  };

  const userStats = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.role === 'admin').length;
    const experts = users.filter((u) => Boolean(u.is_verified_expert)).length;
    const disabled = users.filter((u) => Boolean(u.is_disabled)).length;
    const regulars = users.filter((u) => u.role !== 'admin' && !u.is_verified_expert && !u.is_disabled).length;
    return { total, admins, experts, disabled, regulars };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.username.toLowerCase().includes(query) ||
        (user.email && user.email.toLowerCase().includes(query)) ||
        (user.phone && user.phone.includes(query)) ||
        String(user.id).includes(query);
      const matchesRole =
        roleFilter === 'all'
          ? true
          : roleFilter === 'expert'
            ? Boolean(user.is_verified_expert)
            : roleFilter === 'disabled'
              ? Boolean(user.is_disabled)
              : user.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, roleFilter]);

  const roleTabs = [
    { id: 'all' as const, label: '全部', count: userStats.total },
    { id: 'admin' as const, label: '管理员', count: userStats.admins },
    { id: 'user' as const, label: '普通用户', count: userStats.regulars },
    { id: 'expert' as const, label: '专业用户', count: userStats.experts },
    { id: 'disabled' as const, label: '已停用', count: userStats.disabled },
  ];

  return (
    <div className="flex flex-col gap-5">
      {loadError ? (
        <div role="alert" className="border-destructive/20 bg-destructive/10 text-destructive flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          {loadError}
          <AdminButton className="ml-1" onClick={() => void fetchUsers()}>
            重试
          </AdminButton>
        </div>
      ) : null}
      <PageHeader title="用户管理" description="管理用户身份、账号状态与成长等级。健康档案仅在详情中按需读取。"/>
      <FilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <AdminInput
            aria-label="搜索已加载用户"
            placeholder="搜索用户名、邮箱或手机号"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10"
          />
        </div>
        <AdminField label="角色">
          <AdminSelect
            aria-label="角色筛选"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
          >
            <option value="all">全部角色</option>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
            <option value="expert">认证专家</option>
            <option value="disabled">已停用</option>
          </AdminSelect>
        </AdminField>
        <AdminButton type="button"  disabled={loading} onClick={() => void fetchUsers()}>刷新</AdminButton>
      </FilterBar>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '已加载用户', value: userStats.total, icon: UsersIcon, accent: 'text-primary' },
          { label: '专业用户', value: userStats.experts, icon: BadgeCheck, accent: 'text-primary' },
          { label: '系统管理员', value: userStats.admins, icon: ShieldAlert, accent: 'text-foreground' },
          { label: '停用账号', value: userStats.disabled, icon: UserX, accent: 'text-destructive' },
        ].map((stat) => (
          <Card key={stat.label} className="py-3">
            <CardContent className="flex items-center gap-3">
              <div className={cn('bg-primary/10 flex size-10 items-center justify-center rounded-xl', stat.accent)}>
                <stat.icon className="size-5" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{stat.label}</p>
                <p className={cn('text-xl font-semibold tracking-tight', stat.accent)}>
                  {loading || loadError ? '—' : stat.value.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {roleTabs.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              size="sm"
              variant={roleFilter === tab.id ? 'default' : 'outline'}
              className="gap-1.5 whitespace-nowrap"
              onClick={() => {
                setRoleFilter(tab.id);
                setPage(1);
              }}
            >
              {tab.label}
              <Badge variant={roleFilter === tab.id ? 'secondary' : 'outline'} className="px-1.5 py-0 text-[10px]">
                {tab.count}
              </Badge>
            </Button>
          ))}
        </div>
        <span className="text-muted-foreground shrink-0 text-xs font-medium">已显示 {filteredUsers.length} 项</span>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>用户列表</CardTitle>
          <CardDescription>点击行打开详情；停用与角色变更可在详情「账号操作」中完成。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          {loading ? (
            <EmptyState>正在加载用户列表...</EmptyState>
          ) : loadError && users.length === 0 ? (
            <EmptyState>用户列表暂不可用，请重试。</EmptyState>
          ) : filteredUsers.length === 0 ? (
            <EmptyState>未找到符合条件的用户。请重新输入搜索关键字或切换筛选条件。</EmptyState>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-14 text-center">ID</TableHead>
                    <TableHead>用户信息</TableHead>
                    <TableHead>联系方式</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>注册时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const isDisabled = Boolean(user.is_disabled);
                    return (
                      <TableRow
                        key={user.id}
                        className={cn('cursor-pointer', isDisabled && 'opacity-70')}
                        onClick={() => openUserDetail(user)}
                      >
                        <TableCell className="text-muted-foreground text-center font-mono text-xs">{user.id}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <img
                              src={getAvatarUrl(user.avatar_url, user.id)}
                              alt={user.username}
                              className="ring-foreground/10 size-10 shrink-0 rounded-full object-cover ring-1"
                            />
                            <div className="min-w-0">
                              <button
                                type="button"
                                className="text-primary truncate font-semibold"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openUserDetail(user);
                                }}
                              >
                                {user.username}
                              </button>
                              <div className="text-muted-foreground truncate text-xs">@{user.username}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {user.email ? (
                            <span className="text-foreground flex items-center gap-1.5">
                              <Mail className="text-muted-foreground size-3.5" />
                              {user.email}
                            </span>
                          ) : user.phone ? (
                            <span className="text-foreground flex items-center gap-1.5">
                              <Phone className="text-muted-foreground size-3.5" />
                              {user.phone}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="gap-1">
                            {user.role === 'admin' ? <ShieldAlert className="size-3" /> : <User className="size-3" />}
                            {user.role === 'admin' ? '管理员' : '普通用户'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {isDisabled ? (
                            <StatusBadge tone="danger">已停用</StatusBadge>
                          ) : (
                            <StatusBadge tone="success">正常</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(user.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant={isDisabled ? 'outline' : 'ghost'}
                            className={cn(!isDisabled && 'text-destructive hover:text-destructive')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmStatusModal({
                                userId: user.id,
                                currentDisabled: isDisabled,
                              });
                            }}
                          >
                            {isDisabled ? '恢复启用' : '停用账号'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {nextCursor ? (
                <div className="border-border border-t px-4 py-3 text-center">
                  <AdminButton type="button" disabled={loading} onClick={() => void fetchUsers(nextCursor)}>
                    加载更多用户
                  </AdminButton>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* User Detail Side Panel */}
      {selectedUser && (
        <DetailPanel
          title={selectedUser.username}
          onClose={closeUserDetail}
          dirty={Boolean(xpDelta || xpReason || resetPassword || credentialIdentifier !== (selectedUser.email || selectedUser.phone || selectedUser.username))}
          busy={credentialsSaving || xpSaving}
        >
            <div className="mt-1 flex items-center gap-4 text-left">
              <img
                src={getAvatarUrl(selectedUser.avatar_url, selectedUser.id)}
                alt={selectedUser.username}
                className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted-foreground">用户资料</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium",
                    selectedUser.role === 'admin' ? "bg-secondary/10 text-secondary" : "bg-muted text-foreground"
                  )}>
                    {selectedUser.role === 'admin' ? <ShieldAlert className="w-4 h-4" /> : <User className="w-4 h-4" />}
                    {selectedUser.role === 'admin' ? '管理员' : '普通用户'}
                  </span>
                  <span className="inline-flex items-center rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground font-mono">ID {selectedUser.id}</span>
                  {selectedUser.is_disabled ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
                      <UserX className="h-4 w-4" />已停用
                    </span>
                  ) : selectedUser.is_verified_expert ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                      <BadgeCheck className="h-4 w-4" />专业用户
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="border-border mt-6 flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="用户详情分区">
              {([{ id: 'basic', label: '基本信息' }, { id: 'level', label: '成长等级' }, { id: 'health', label: '健康与饮食档案' }, { id: 'account', label: '账号操作' }] as const).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={detailTab === tab.id}
                  className={cn(
                    'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    detailTab === tab.id
                      ? 'border-primary text-primary'
                      : 'text-muted-foreground hover:text-foreground border-transparent',
                  )}
                  onClick={() => {
                    setDetailTab(tab.id)
                    if (tab.id === 'health' && !healthProfileDetail && !healthProfileLoading) void fetchHealthProfileDetail(selectedUser.id)
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="space-y-4">
              {detailTab === 'basic' && <div className="rounded-2xl border border-border bg-background/60 p-3.5 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">注册时间</h3>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {new Date(selectedUser.created_at).toLocaleString()}
                  </p>
                </div>
                <Sparkles className="w-5 h-5 text-primary/40" />
              </div>}
              {detailTab === 'basic' && <dl className="grid gap-3 text-sm"><div><dt className="text-muted-foreground text-xs">邮箱</dt><dd>{selectedUser.email || '未绑定'}</dd></div><div><dt className="text-muted-foreground text-xs">手机号</dt><dd>{selectedUser.phone || '未绑定'}</dd></div></dl>}

              {detailTab === 'health' && <AdminHealthProfileCard
                data={healthProfileDetail}
                loading={healthProfileLoading}
                error={healthProfileError}
                onRetry={() => void fetchHealthProfileDetail(selectedUser.id)}
              />}

              {detailTab === 'level' && <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                <h3 className="text-sm font-semibold text-foreground">成长等级</h3>
                <div className="mt-3 flex items-end justify-between"><div><p className="text-lg font-bold text-amber-700">V{selectedUser.level?.level ?? 1} · {selectedUser.level?.title ?? '健康新芽'}</p><p className="mt-1 text-xs text-muted-foreground">{selectedUser.level?.xp ?? 0} XP（行为 {selectedUser.level?.baseXp ?? 0} / 修正 {selectedUser.level?.adjustmentXp ?? 0}）</p></div><span className="text-xs font-medium text-amber-700">{selectedUser.level?.progress ?? 0}%</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${selectedUser.level?.progress ?? 0}%` }} /></div>
                <div className="mt-4 border-t border-amber-100 pt-4">
                  <p className="text-xs font-medium text-muted-foreground">经验修正（活动奖励、申诉补偿或违规扣减）</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <AdminInput value={xpDelta} onChange={(event) => setXpDelta(event.target.value)} placeholder="+100 / -50" />
                    <AdminInput className="col-span-2" value={xpReason} onChange={(event) => setXpReason(event.target.value)} placeholder="必须填写原因" />
                  </div>
                  {xpMessage ? <p className="mt-2 text-xs text-muted-foreground">{xpMessage}</p> : null}
                  <AdminButton type="button" onClick={() => void handleAdjustXp()} disabled={xpSaving} variant="primary" className="mt-3 w-full">{xpSaving ? '保存中…' : '提交经验修正'}</AdminButton>
                </div>
              </div>}

              {detailTab === 'account' && selectedUser.role !== 'admin' ? (
                <div className="rounded-2xl border border-border p-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Lock className="w-4 h-4 text-primary" /> 登录凭证管理
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">修改用户登录绑定的手机号/邮箱，或强制设置新密码。</p>
                  <div className="mt-4 space-y-3">
                    <AdminField label="登录邮箱或手机号">
                      <AdminInput
                        type="text"
                        value={credentialIdentifier}
                        onChange={(event) => setCredentialIdentifier(event.target.value)}
                      />
                    </AdminField>
                    <AdminField label="重置密码（留空则不修改）">
                      <AdminInput
                        type="password"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                        placeholder="至少 6 位，包含字母和数字"
                      />
                    </AdminField>
                    {credentialsMessage ? <p className="text-xs text-muted-foreground">{credentialsMessage}</p> : null}
                    <AdminButton
                      type="button"
                      onClick={() => void handleSaveCredentials()}
                      disabled={credentialsSaving}
                      variant="primary"
                      className="w-full"
                    >
                      {credentialsSaving ? '保存中…' : '保存登录信息'}
                    </AdminButton>
                  </div>
                </div>
              ) : null}
            </div>

            <div hidden={detailTab !== 'account'} className="mt-6 pt-4 border-t border-border space-y-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmStatusModal({
                    userId: selectedUser.id,
                    currentDisabled: Boolean(selectedUser.is_disabled),
                  });
                }}
                className={cn(
                  "w-full rounded-2xl py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2",
                  selectedUser.is_disabled
                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "bg-red-50 text-red-600 hover:bg-red-100"
                )}
              >
                {selectedUser.is_disabled ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                {selectedUser.is_disabled ? '恢复账号使用' : '停用该账号'}
              </button>

              <button
                type="button"
                onClick={() => void handleToggleExpert(selectedUser.id, Boolean(selectedUser.is_verified_expert))}
                className={cn(
                  "w-full rounded-2xl py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2",
                  selectedUser.is_verified_expert
                    ? "bg-green-50 text-green-700 hover:bg-green-100"
                    : "bg-muted text-primary hover:bg-primary/10"
                )}
              >
                <BadgeCheck className="w-4 h-4" />
                {selectedUser.is_verified_expert ? '取消专业用户认证' : '认证为专业用户'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfirmRoleModal({ userId: selectedUser.id, currentRole: selectedUser.role });
                }}
                className={cn(
                  "w-full py-3 rounded-2xl font-medium text-sm transition-colors flex items-center justify-center gap-2",
                  selectedUser.role === 'admin'
                    ? "bg-muted text-foreground hover:bg-muted/80"
                    : "bg-primary text-white hover:bg-primary/90"
                )}
              >
                <ShieldAlert className="w-4 h-4" />
                {selectedUser.role === 'admin' ? '取消管理员权限' : '设为管理员'}
              </button>
            </div>
          
        </DetailPanel>
      )}

      {/* Confirm Disable/Enable Modal */}
      {confirmStatusModal && (
        <ConfirmDialog title={confirmStatusModal.currentDisabled ? '恢复账号使用' : '停用账号'} description={confirmStatusModal.currentDisabled ? '确认恢复该账号的正常使用？' : '停用后该用户将无法正常登录和使用服务，确认继续？'} onCancel={()=>setConfirmStatusModal(null)} onConfirm={()=>void handleToggleDisabled(confirmStatusModal.userId,confirmStatusModal.currentDisabled)} busy={accountSaving}/>
      )}

      {/* Confirm Role Modal */}
      {confirmRoleModal && (
        <ConfirmDialog title="确认修改角色" description={confirmRoleModal.currentRole === 'admin' ? '确认取消该用户的管理员权限？' : '该用户将获得管理后台权限，确认设为管理员？'} onCancel={()=>setConfirmRoleModal(null)} onConfirm={()=>void handleToggleRole(confirmRoleModal.userId,confirmRoleModal.currentRole)} busy={accountSaving}/>
      )}
    </div>
  );
}

const severityLabels: Record<AllergySeverity, string> = { mild: '轻度', moderate: '中度', severe: '重度' };
const cookingLevelLabels: Record<string, string> = { beginner: '新手', intermediate: '熟练', advanced: '进阶' };
const eatingOutLabels: Record<string, string> = { rarely: '很少外食', sometimes: '偶尔外食', often: '经常外食' };

function AdminHealthProfileCard({
  data,
  loading,
  error,
  onRetry,
}: {
  data: AdminHealthProfileResponse | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const profile = data?.profile;
  const kitchen = profile?.kitchen_constraints || {};
  const targets = profile?.nutrition_targets || {};
  const latest = data?.latest_tracking;
  const basicFacts = profile ? [
    profile.gender ? `性别 ${profile.gender}` : null,
    profile.age ? `${profile.age} 岁` : null,
    profile.height ? `身高 ${profile.height} cm` : null,
    profile.weight ? `体重 ${profile.weight} kg` : null,
    profile.target_weight ? `目标 ${profile.target_weight} kg` : null,
  ].filter(Boolean) as string[] : [];
  const kitchenFacts = [
    kitchen.meal_time_minutes ? `每餐 ${kitchen.meal_time_minutes} 分钟` : null,
    kitchen.budget_per_meal ? `预算 ¥${kitchen.budget_per_meal}` : null,
    kitchen.servings ? `${kitchen.servings} 人用餐` : null,
    kitchen.cooking_level ? cookingLevelLabels[kitchen.cooking_level] : null,
    kitchen.eating_out_frequency ? eatingOutLabels[kitchen.eating_out_frequency] : null,
  ].filter(Boolean) as string[];
  const targetFacts = [
    targets.calories_kcal ? `热量 ${targets.calories_kcal} kcal` : null,
    targets.protein_g ? `蛋白质 ${targets.protein_g} g` : null,
    targets.salt_g ? `盐 ${targets.salt_g} g` : null,
    targets.sugar_g ? `糖 ${targets.sugar_g} g` : null,
    targets.water_ml ? `饮水 ${targets.water_ml} ml` : null,
  ].filter(Boolean) as string[];
  const latestFacts = latest ? [
    latest.weight != null ? `体重 ${latest.weight} kg` : null,
    latest.body_fat != null ? `体脂 ${latest.body_fat}%` : null,
    latest.waist_cm != null ? `腰围 ${latest.waist_cm} cm` : null,
    latest.blood_pressure_systolic != null && latest.blood_pressure_diastolic != null ? `血压 ${latest.blood_pressure_systolic}/${latest.blood_pressure_diastolic}` : null,
    latest.blood_glucose_mmol != null ? `血糖 ${latest.blood_glucose_mmol} mmol/L` : null,
    latest.sleep_hours != null ? `睡眠 ${latest.sleep_hours} h` : null,
    latest.cycle_status ? latest.cycle_status : null,
  ].filter(Boolean) as string[] : [];

  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-rose-100 p-2 text-rose-700"><ShieldCheck className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">健康与饮食档案</h3>
            <p className="mt-0.5 text-[10px] text-rose-700">敏感资料 · 只读查看 · 访问已审计</p>
          </div>
        </div>
        {profile?.updated_at ? <span className="text-[10px] text-muted-foreground">更新于 {new Date(profile.updated_at).toLocaleDateString()}</span> : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />正在读取已保存档案…</div>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-red-100 bg-white p-3 text-xs text-red-600">
          <p>{error}</p><button type="button" onClick={onRetry} className="mt-2 font-semibold text-primary">重新加载</button>
        </div>
      ) : !profile && !latest ? (
        <div className="mt-4 rounded-xl border border-dashed border-rose-200 bg-white/70 p-4 text-center">
          <p className="text-sm font-semibold text-foreground">该用户尚未建档</p>
          <p className="mt-1 text-xs text-muted-foreground">客户端保存后会在此处显示。</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {basicFacts.length ? <FactChips items={basicFacts} /> : null}

          {profile?.allergies?.length ? (
            <div className="rounded-xl border border-red-100 bg-white p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700"><ShieldAlert className="h-3.5 w-3.5" />过敏与不耐受</div>
              <div className="mt-2 flex flex-wrap gap-1.5">{profile.allergies.map((item) => <span key={`${item.name}-${item.type}`} className={cn('rounded-lg border px-2 py-1 text-[11px] font-semibold', item.severity === 'severe' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>{item.name} · {severityLabels[item.severity]} · {item.type === 'allergy' ? '过敏' : '不耐受'}</span>)}</div>
            </div>
          ) : <EmptyHealthLine label="未记录过敏或不耐受" />}

          {profile?.medications ? <HealthDetailLine icon={<Pill className="h-3.5 w-3.5" />} label="用药与补充剂" value={profile.medications} sensitive /> : null}
          {profile?.medical_conditions?.length ? <HealthDetailLine icon={<HeartPulse className="h-3.5 w-3.5" />} label="疾病与特殊状态" value={profile.medical_conditions.join('、')} sensitive /> : null}
          {profile?.medical_notes ? <HealthDetailLine icon={<HeartPulse className="h-3.5 w-3.5" />} label="健康备注" value={profile.medical_notes} sensitive /> : null}
          {profile?.dietary_restrictions?.length ? <HealthDetailLine icon={<ShieldCheck className="h-3.5 w-3.5" />} label="饮食限制" value={profile.dietary_restrictions.join('、')} /> : null}
          {profile?.disliked_foods ? <HealthDetailLine icon={<CookingPot className="h-3.5 w-3.5" />} label="不喜欢的食物" value={profile.disliked_foods} /> : null}

          {kitchenFacts.length ? <HealthFactSection icon={<CookingPot className="h-3.5 w-3.5" />} label="厨房与生活约束" items={kitchenFacts} /> : null}
          {targetFacts.length || targets.professional_advice ? <div className="rounded-xl border border-border bg-white p-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Target className="h-3.5 w-3.5 text-primary" />营养目标与专业建议</div>{targetFacts.length ? <div className="mt-2"><FactChips items={targetFacts} /></div> : null}{targets.professional_advice ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{targets.professional_advice}</p> : null}</div> : null}

          <div className="rounded-xl border border-border bg-white p-3">
            <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Activity className="h-3.5 w-3.5 text-primary" />体征追踪</div><span className="text-[10px] text-muted-foreground">共 {data?.tracking_count || 0} 条</span></div>
            {latest ? <><p className="mt-1 text-[10px] text-muted-foreground">最近记录：{latest.recorded_date}</p>{latestFacts.length ? <div className="mt-2"><FactChips items={latestFacts} /></div> : null}</> : <p className="mt-2 text-xs text-muted-foreground">尚无追踪记录</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function FactChips({ items }: { items: string[] }) {
  return <div className="flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className="rounded-lg bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{item}</span>)}</div>;
}

function HealthDetailLine({ icon, label, value, sensitive = false }: { icon: ReactNode; label: string; value: string; sensitive?: boolean }) {
  return <div className={cn('rounded-xl border bg-white p-3', sensitive ? 'border-rose-100' : 'border-border')}><div className={cn('flex items-center gap-1.5 text-[11px] font-semibold', sensitive ? 'text-rose-700' : 'text-muted-foreground')}>{icon}{label}</div><p className="mt-1 text-xs leading-5 text-foreground break-words">{value}</p></div>;
}

function HealthFactSection({ icon, label, items }: { icon: ReactNode; label: string; items: string[] }) {
  return <div className="rounded-xl border border-border bg-white p-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">{icon}{label}</div><div className="mt-2"><FactChips items={items} /></div></div>;
}

function EmptyHealthLine({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-white/70 px-3 py-2 text-xs text-muted-foreground">{label}</div>;
}
