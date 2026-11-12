import { DialogFrame } from '../components/admin/DialogFrame';
import { AdminField, AdminInput, AdminPagination, AdminSelect } from '../components/admin/FormControls';
import { useQueryState } from '../hooks/useQueryState';
import KitchenwareCapabilities from './KitchenwareCapabilities';
import { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { CookingPot, Pencil, PlusCircle, Search, Trash2, UserRound, Wrench, X } from 'lucide-react';
import api from '../services/api';
import { asAdminPage } from '../utils/adminResponses';

interface KitchenwareItem {
  id: number;
  user_id: number;
  name: string;
  category: string;
  status: string;
  note: string | null;
  image_url: string | null;
  purchase_date: string | null;
  last_maintained_at: string | null;
  created_at: string;
  owner_username: string;
}

interface KitchenwareCatalogItem {
  id: number;
  name: string;
  category: string;
  aliases?: string | null;
  cooking_methods?: string | null;
  care_note?: string | null;
  image_url?: string | null;
  description?: string | null;
  source?: string | null;
}

const DEFAULT_CATEGORIES = ['全部', '小家电', '烹饪锅具', '刀具餐具', '烘焙工具', '烹饪电器', '锅具与烘焙器具', '刀具与手动工具', '餐具与食物容器', '其他'];
const statuses = ['全部', '常用', '良好', '需保养', '维修中', '闲置'];

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleDateString('zh-CN');
}

function parseListJson(raw?: string | null) {
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(/[、,，]/).map((part) => part.trim()).filter(Boolean);
  }
}

export default function Kitchenware() {
  const [capabilityItem, setCapabilityItem] = useState<KitchenwareCatalogItem | null>(null);
  const [activeTab] = useQueryState<'catalog' | 'assets'>('tab', 'catalog', ['catalog', 'assets']);
  const [items, setItems] = useState<KitchenwareItem[]>([]);
  const [catalog, setCatalog] = useState<KitchenwareCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useQueryState<string>('q', '');
  const [category, setCategory] = useQueryState<string>('category', '全部');
  const [status, setStatus] = useQueryState<string>('status', '全部', statuses);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [total, setTotal] = useState(0);
  const pendingSave = useRef<symbol | null>(null);
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [catalogSaveError, setCatalogSaveError] = useState('');
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [editingCatalogItem, setEditingCatalogItem] = useState<KitchenwareCatalogItem | null>(null);
  const [catalogForm, setCatalogForm] = useState({
    name: '',
    category: '其他',
    aliases: '',
    cookingMethods: '',
    careNote: '',
    imageUrl: '',
  });

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/kitchenware', {
        params: {
          search: search.trim() || undefined,
          category,
          status,
          page,
          pageSize,
        },
      });
      const pageData = asAdminPage<KitchenwareItem>(response.data, ['items']);
      setItems(pageData.items);
      setTotal(pageData.total);
      setMessage('');
    } catch (error) {
      console.error('Kitchenware loading failed:', error);
      setMessage('厨具数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [category, page, search, status]);

  const fetchCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/kitchenware/catalog', {
        params: {
          search: search.trim() || undefined,
          category,
          page,
          pageSize,
        },
      });
      const pageData = asAdminPage<KitchenwareCatalogItem>(response.data, ['items']);
      setCatalog(pageData.items);
      setTotal(pageData.total);
      setMessage('');
    } catch (error) {
      console.error('Kitchenware catalog loading failed:', error);
      setMessage('官方厨具目录加载失败');
    } finally {
      setLoading(false);
    }
  }, [category, page, search]);

  const currentCatalogRefresh = useRef<typeof fetchCatalog | null>(null);
  useLayoutEffect(() => {
    currentCatalogRefresh.current = fetchCatalog;
    return () => { currentCatalogRefresh.current = null; };
  }, [fetchCatalog]);
  useLayoutEffect(() => () => { pendingSave.current = null; }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (activeTab === 'catalog') void fetchCatalog();
      else void fetchItems();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeTab, fetchCatalog, fetchItems]);

  const categories = useMemo(() => {
    const found = new Set(DEFAULT_CATEGORIES);
    for (const item of [...catalog, ...items]) {
      if (item.category) found.add(item.category);
    }
    return Array.from(found);
  }, [catalog, items]);

  const stats = useMemo(() => ({
    total,
    catalogTotal: activeTab === 'catalog' ? total : catalog.length,
    attention: items.filter((item) => item.status === '需保养' || item.status === '维修中').length,
    owners: new Set(items.map((item) => item.user_id)).size,
  }), [activeTab, catalog.length, items, total]);

  const updateStatus = async (item: KitchenwareItem, nextStatus: string) => {
    try {
      await api.put(`/admin/kitchenware/${item.id}/status`, { status: nextStatus });
      setItems((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, status: nextStatus } : entry
      )));
    } catch (error: any) {
      setMessage(error.response?.data?.error || '状态更新失败');
    }
  };

  const removeItem = async (item: KitchenwareItem) => {
    if (!window.confirm(`确定要将厨具【${item.name}】移入回收站吗？`)) return;
    try {
      await api.delete(`/admin/kitchenware/${item.id}`);
      void fetchItems();
    } catch (error: any) {
      setMessage(error.response?.data?.error || '删除失败');
    }
  };

  const removeCatalogItem = async (item: KitchenwareCatalogItem) => {
    if (!window.confirm(`确定删除官方厨具【${item.name}】吗？`)) return;
    try {
      await api.delete(`/admin/kitchenware/catalog/${item.id}`);
      void fetchCatalog();
    } catch (error: any) {
      setMessage(error.response?.data?.error || '删除失败');
    }
  };

  const closeCatalogModal = () => { if (!pendingSave.current) setCatalogModalOpen(false); };

  const openCatalogModal = (item?: KitchenwareCatalogItem) => {
    if (pendingSave.current) return;
    setCatalogSaveError('');
    setEditingCatalogItem(item || null);
    setCatalogForm({
      name: item?.name || '',
      category: item?.category || '其他',
      aliases: parseListJson(item?.aliases).join('、'),
      cookingMethods: parseListJson(item?.cooking_methods).join('、'),
      careNote: item?.care_note || item?.description || '',
      imageUrl: item?.image_url || '',
    });
    setCatalogModalOpen(true);
  };

  const saveCatalogItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pendingSave.current) return;
    const token = Symbol('save');
    pendingSave.current = token;
    setSavingCatalog(true);
    setCatalogSaveError('');
    const payload = {
      name: catalogForm.name.trim(),
      category: catalogForm.category,
      aliases: catalogForm.aliases.split(/[、,，]/).map((part) => part.trim()).filter(Boolean),
      cooking_methods: catalogForm.cookingMethods.split(/[、,，]/).map((part) => part.trim()).filter(Boolean),
      care_note: catalogForm.careNote.trim(),
      image_url: catalogForm.imageUrl.trim() || null,
      description: catalogForm.careNote.trim() || null,
    };
    try {
      if (editingCatalogItem) {
        await api.put(`/admin/kitchenware/catalog/${editingCatalogItem.id}`, payload);
      } else {
        await api.post('/admin/kitchenware/catalog', payload);
      }
      if (pendingSave.current === token) {
        setCatalogModalOpen(false);
        void currentCatalogRefresh.current?.();
      }
    } catch (error: any) {
      if (pendingSave.current === token) {
        setCatalogSaveError(error.response?.data?.error || '保存失败');
      }
    } finally {
      if (pendingSave.current === token) pendingSave.current = null;
      setSavingCatalog(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-main">厨具管理</h1>
          <p className="mt-1 text-sm text-text-muted">维护官方厨具目录与用户资产，支持图片与分页浏览。</p>
        </div>
        {activeTab === 'catalog' ? (
          <button type="button" onClick={() => openCatalogModal()} className="admin-button admin-button-primary inline-flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />新增官方厨具
          </button>
        ) : null}
      </div>

      <div className="admin-stat-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">{activeTab === 'catalog' ? '官方厨具' : '用户厨具'}</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{loading ? '—' : total.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3 text-primary"><CookingPot className="h-6 w-6" /></div>
        </div>
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">当前页条目</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{loading ? '—' : (activeTab === 'catalog' ? catalog.length : items.length)}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><Wrench className="h-6 w-6" /></div>
        </div>
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">需关注资产</p>
            <p className="mt-1.5 text-2xl font-bold text-amber-600">{loading ? '—' : stats.attention}</p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-3 text-amber-600"><Wrench className="h-6 w-6" /></div>
        </div>
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">关联录入用户</p>
            <p className="mt-1.5 text-2xl font-bold text-primary">{loading ? '—' : stats.owners}</p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><UserRound className="h-6 w-6" /></div>
        </div>
      </div>

      <section className="rounded-[24px] bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end">
          <AdminField label="搜索" className="min-w-[220px] flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <AdminInput
                className="pl-10"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder={activeTab === 'catalog' ? '搜索官方厨具、别名或描述' : '搜索厨具、备注或用户名'}
              />
            </div>
          </AdminField>
          <AdminField label="分类">
            <AdminSelect value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </AdminSelect>
          </AdminField>
          {activeTab === 'assets' ? (
            <AdminField label="状态">
              <AdminSelect value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                {statuses.map((item) => <option key={item}>{item}</option>)}
              </AdminSelect>
            </AdminField>
          ) : null}
        </div>

        {message ? (
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{message}</div>
        ) : null}

        {activeTab === 'assets' ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-background-alt text-xs text-text-muted">
                  <th className="pb-3 font-medium">厨具</th>
                  <th className="pb-3 font-medium">所属用户</th>
                  <th className="pb-3 font-medium">分类</th>
                  <th className="pb-3 font-medium">状态</th>
                  <th className="pb-3 font-medium">购买日期</th>
                  <th className="pb-3 font-medium">最近保养</th>
                  <th className="pb-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-background-alt/70 text-sm last:border-0">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                            <CookingPot className="h-5 w-5 text-primary" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-text-main">{item.name}</p>
                          <p className="mt-0.5 max-w-[250px] truncate text-xs text-text-muted">{item.note || '无备注'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4">
                      <div className="flex items-center gap-2 text-text-main">
                        <UserRound className="h-4 w-4 text-text-muted" />
                        {item.owner_username}
                      </div>
                    </td>
                    <td className="py-4 text-text-muted">{item.category}</td>
                    <td className="py-4">
                      <AdminSelect value={item.status} onChange={(event) => updateStatus(item, event.target.value)}>
                        {statuses.slice(1).map((entry) => <option key={entry}>{entry}</option>)}
                      </AdminSelect>
                    </td>
                    <td className="py-4 text-text-muted">{item.purchase_date || '—'}</td>
                    <td className="py-4 text-text-muted">{formatDate(item.last_maintained_at)}</td>
                    <td className="py-4 text-right">
                      <button type="button" onClick={() => removeItem(item)} className="rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50" title="移入回收站">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !items.length ? <div className="py-14 text-center text-sm text-text-muted">没有匹配的厨具记录</div> : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-background-alt text-xs text-text-muted">
                  <th className="pb-3 font-medium">官方厨具</th>
                  <th className="pb-3 font-medium">分类</th>
                  <th className="pb-3 font-medium">别名</th>
                  <th className="pb-3 font-medium">来源</th>
                  <th className="pb-3 font-medium">说明</th>
                  <th className="pb-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((item) => (
                  <tr key={item.id} className="border-b border-background-alt/70 text-sm last:border-0">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                            <CookingPot className="h-5 w-5 text-primary" />
                          </div>
                        )}
                        <p className="font-medium text-text-main">{item.name}</p>
                      </div>
                    </td>
                    <td className="py-4 text-text-muted">{item.category}</td>
                    <td className="py-4 text-text-muted">{parseListJson(item.aliases).join('、') || '—'}</td>
                    <td className="py-4 text-text-muted">{item.source || '—'}</td>
                    <td className="max-w-[240px] py-4 text-text-muted">{item.description || item.care_note || '—'}</td>
                    <td className="py-4 text-right">
                      <button type="button" onClick={() => setCapabilityItem(item)} className="rounded-lg p-2 text-primary">能力条件</button>
                      <button type="button" onClick={() => openCatalogModal(item)} className="rounded-lg p-2 text-primary hover:bg-primary/10" title="编辑">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => removeCatalogItem(item)} className="rounded-lg p-2 text-red-500 hover:bg-red-50" title="删除">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !catalog.length ? <div className="py-14 text-center text-sm text-text-muted">没有匹配的官方厨具</div> : null}
          </div>
        )}

        <AdminPagination page={page} pageSize={pageSize} total={total} disabled={loading} onChange={setPage} />
      </section>

      {capabilityItem ? <KitchenwareCapabilities key={capabilityItem.id} item={capabilityItem} onClose={() => setCapabilityItem(null)} /> : null}
      {catalogModalOpen ? (
        <DialogFrame onClose={closeCatalogModal} busy={savingCatalog} className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <form onSubmit={saveCatalogItem} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-main">{editingCatalogItem ? '编辑官方厨具' : '新增官方厨具'}</h2>
              <button aria-label="关闭" type="button" disabled={savingCatalog} onClick={closeCatalogModal} className="text-text-muted"><X /></button>
            </div>
            <fieldset disabled={savingCatalog} className="space-y-4">
              <AdminField label="名称">
                <AdminInput required value={catalogForm.name} onChange={(event) => setCatalogForm({ ...catalogForm, name: event.target.value })} />
              </AdminField>
              <AdminField label="分类">
                <AdminSelect value={catalogForm.category} onChange={(event) => setCatalogForm({ ...catalogForm, category: event.target.value })}>
                  {categories.filter((item) => item !== '全部').map((item) => <option key={item}>{item}</option>)}
                </AdminSelect>
              </AdminField>
              <AdminField label="图片 URL">
                <AdminInput value={catalogForm.imageUrl} onChange={(event) => setCatalogForm({ ...catalogForm, imageUrl: event.target.value })} placeholder="https://..." />
              </AdminField>
              <AdminField label="别名（用顿号或逗号分隔）">
                <AdminInput value={catalogForm.aliases} onChange={(event) => setCatalogForm({ ...catalogForm, aliases: event.target.value })} />
              </AdminField>
              <AdminField label="烹饪方式（用顿号或逗号分隔）">
                <AdminInput value={catalogForm.cookingMethods} onChange={(event) => setCatalogForm({ ...catalogForm, cookingMethods: event.target.value })} />
              </AdminField>
              <AdminField label="保养提示 / 说明">
                <textarea
                  value={catalogForm.careNote}
                  onChange={(event) => setCatalogForm({ ...catalogForm, careNote: event.target.value })}
                  className="admin-field min-h-20"
                />
              </AdminField>
            </fieldset>
            {catalogSaveError ? <p role="alert" className="mt-4 text-sm text-red-600">{catalogSaveError}</p> : null}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" disabled={savingCatalog} onClick={closeCatalogModal} className="admin-button">取消</button>
              <button type="submit" disabled={savingCatalog} className="admin-button admin-button-primary">保存</button>
            </div>
          </form>
        </DialogFrame>
      ) : null}
    </div>
  );
}
