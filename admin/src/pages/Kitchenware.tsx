import { DialogFrame } from '../components/admin/DialogFrame';
import { useQueryState } from '../hooks/useQueryState';
import KitchenwareCapabilities from "./KitchenwareCapabilities";
import { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { CookingPot, Pencil, PlusCircle, RefreshCw, Search, Trash2, UserRound, Wrench, X } from 'lucide-react';
import api from '../services/api';

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
  aliases: string | null;
  cooking_methods: string | null;
  care_note: string | null;
}

const categories = ['全部', '小家电', '烹饪锅具', '刀具餐具', '烘焙工具', '其他'];
const statuses = ['全部', '常用', '良好', '需保养', '维修中', '闲置'];

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleDateString('zh-CN');
}

export default function Kitchenware() {
  const [capabilityItem, setCapabilityItem] = useState<KitchenwareCatalogItem | null>(null);
  const [activeTab] = useQueryState<'catalog' | 'assets'>('tab', 'catalog', ["catalog", "assets"]);
  const [items, setItems] = useState<KitchenwareItem[]>([]);
  const [catalog, setCatalog] = useState<KitchenwareCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useQueryState<string>('q', '');
  const [category, setCategory] = useQueryState<string>('category', '全部', ["全部", "小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]);
  const [status, setStatus] = useQueryState<string>('status', '全部', statuses);
  const [message, setMessage] = useState('');
  const pendingSave = useRef<symbol | null>(null);
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [catalogSaveError, setCatalogSaveError] = useState('');
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [editingCatalogItem, setEditingCatalogItem] = useState<KitchenwareCatalogItem | null>(null);
  const [catalogForm, setCatalogForm] = useState({ name: '', category: '其他', aliases: '', cookingMethods: '', careNote: '' });

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<KitchenwareItem[]>('/admin/kitchenware', {
        params: { search: search.trim() || undefined, category, status },
      });
      setItems(response.data);
      setMessage('');
    } catch (error) {
      console.error('Kitchenware loading failed:', error);
      setMessage('厨具数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [category, search, status]);

  const fetchCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<KitchenwareCatalogItem[]>('/admin/kitchenware/catalog', {
        params: { search: search.trim() || undefined, category },
      });
      setCatalog(response.data);
      setMessage('');
    } catch (error) {
      console.error('Kitchenware catalog loading failed:', error);
      setMessage('官方厨具目录加载失败');
    } finally {
      setLoading(false);
    }
  }, [category, search]);

  const currentCatalogRefresh = useRef<typeof fetchCatalog | null>(null);
  useLayoutEffect(() => {
    currentCatalogRefresh.current = fetchCatalog;
    return () => { currentCatalogRefresh.current = null; };
  }, [fetchCatalog]);
  useLayoutEffect(() => () => { pendingSave.current = null; }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchCatalog();
      fetchItems();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchCatalog, fetchItems]);

  const stats = useMemo(() => ({
    total: items.length,
    catalogTotal: catalog.length,
    attention: items.filter((item) => item.status === '需保养' || item.status === '维修中').length,
    owners: new Set(items.map((item) => item.user_id)).size,
  }), [items, catalog]);

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
      setItems((current) => current.filter((entry) => entry.id !== item.id));
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
      aliases: item?.aliases ? JSON.parse(item.aliases).join('、') : '',
      cookingMethods: item?.cooking_methods ? JSON.parse(item.cooking_methods).join('、') : '',
      careNote: item?.care_note || '',
    });
    setCatalogModalOpen(true);
  };

  const saveCatalogItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pendingSave.current) return;
    const owner = Symbol();
    pendingSave.current = owner;
    setSavingCatalog(true);
    setCatalogSaveError('');
    try {
      const payload = {
        name: catalogForm.name.trim(),
        category: catalogForm.category,
        aliases: catalogForm.aliases.split(/[、,，]/).map((value) => value.trim()).filter(Boolean),
        cooking_methods: catalogForm.cookingMethods.split(/[、,，]/).map((value) => value.trim()).filter(Boolean),
        care_note: catalogForm.careNote.trim(),
      };
      if (editingCatalogItem) await api.put(`/admin/kitchenware/catalog/${editingCatalogItem.id}`, payload);
      else await api.post('/admin/kitchenware/catalog', payload);
      if (pendingSave.current !== owner) return;
      setCatalogModalOpen(false);
      void currentCatalogRefresh.current?.();
    } catch (error: any) {
      if (pendingSave.current === owner) setCatalogSaveError(error.response?.data?.error || '保存官方厨具失败');
    } finally {
      if (pendingSave.current === owner) {
        pendingSave.current = null;
        setSavingCatalog(false);
      }
    }
  };

  const removeCatalogItem = async (item: KitchenwareCatalogItem) => {
    if (!window.confirm(`确定删除官方厨具【${item.name}】吗？不会删除用户已经录入的同名厨具。`)) return;
    try {
      await api.delete(`/admin/kitchenware/catalog/${item.id}`);
      setCatalog((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error: any) {
      setMessage(error.response?.data?.error || '删除官方厨具失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-main">
            <CookingPot className="h-7 w-7 text-primary" />
            厨具库
          </h1>
          <p className="mt-1 text-sm text-text-muted">维护官方标准目录，并查看用户录入的厨具资产</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'catalog' ? <button type="button" onClick={() => openCatalogModal()} className="flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm"><PlusCircle className="mr-2 h-4 w-4" />新增官方厨具</button> : null}
          <button type="button" onClick={activeTab === 'catalog' ? fetchCatalog : fetchItems} disabled={loading} className="flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm font-medium shadow-sm disabled:opacity-50"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</button>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">官方厨具目录</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{loading && !catalog.length ? '—' : stats.catalogTotal}</p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <CookingPot className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">用户持存资产</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{loading && !items.length ? '—' : stats.total}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
            <Wrench className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">需保养 / 维修设备</p>
            <p className="mt-1.5 text-2xl font-bold text-amber-600">{loading ? '—' : stats.attention}</p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-3 text-amber-600">
            <Wrench className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">关联录入用户</p>
            <p className="mt-1.5 text-2xl font-bold text-primary">{loading ? '—' : stats.owners}</p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
            <UserRound className="h-6 w-6" />
          </div>
        </div>
      </div>

      {activeTab === 'assets' ? (
        <section className="rounded-[24px] bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row">
            <label className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索厨具、备注或用户名"
                className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-primary"
              />
            </label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-primary"
            >
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-primary"
            >
              {statuses.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          {message ? (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{message}</div>
          ) : null}

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
                      <p className="mt-1 text-xs text-text-muted">@{item.owner_username}</p>
                    </td>
                    <td className="py-4 text-text-muted">{item.category}</td>
                    <td className="py-4">
                      <select
                        value={item.status}
                        onChange={(event) => updateStatus(item, event.target.value)}
                        className="rounded-lg border border-gray-200 bg-background-alt px-2.5 py-1.5 text-xs outline-none"
                      >
                        {statuses.slice(1).map((entry) => <option key={entry}>{entry}</option>)}
                      </select>
                    </td>
                    <td className="py-4 text-text-muted">{item.purchase_date || '—'}</td>
                    <td className="py-4">
                      <span className="inline-flex items-center gap-1.5 text-text-muted">
                        <Wrench className="h-3.5 w-3.5" />
                        {formatDate(item.last_maintained_at)}
                      </span>
                    </td>
                    <td className="py-4 text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(item)}
                        className="rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50"
                        title="移入回收站"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !items.length ? (
              <div className="py-14 text-center text-sm text-text-muted">没有匹配的厨具记录</div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="rounded-[24px] bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row">
            <label className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索官方厨具、别名或烹饪方式"
                className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-primary"
              />
            </label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-primary"
            >
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          {message ? (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{message}</div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-background-alt text-xs text-text-muted">
                  <th className="pb-3 font-medium">官方厨具</th>
                  <th className="pb-3 font-medium">分类</th>
                  <th className="pb-3 font-medium">别名</th>
                  <th className="pb-3 font-medium">烹饪方式</th>
                  <th className="pb-3 font-medium">保养提示</th>
                  <th className="pb-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((item) => (
                  <tr key={item.id} className="border-b border-background-alt/70 text-sm last:border-0">
                    <td className="py-4 font-medium text-text-main">{item.name}</td>
                    <td className="py-4 text-text-muted">{item.category}</td>
                    <td className="py-4 text-text-muted">{item.aliases ? JSON.parse(item.aliases).join('、') : '—'}</td>
                    <td className="py-4 text-text-muted">{item.cooking_methods ? JSON.parse(item.cooking_methods).join('、') : '—'}</td>
                    <td className="max-w-[240px] py-4 text-text-muted">{item.care_note || '—'}</td>
                    <td className="py-4 text-right">
                      <button type="button" onClick={() => setCapabilityItem(item)} className="rounded-lg p-2 text-primary">能力条件</button>
                      <button
                        type="button"
                        onClick={() => openCatalogModal(item)}
                        className="rounded-lg p-2 text-primary hover:bg-primary/10"
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCatalogItem(item)}
                        className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !catalog.length ? (
              <div className="py-14 text-center text-sm text-text-muted">没有匹配的官方厨具</div>
            ) : null}
          </div>
        </section>
      )}

      {capabilityItem && <KitchenwareCapabilities key={capabilityItem.id} item={capabilityItem} onClose={() => setCapabilityItem(null)} />}
      {catalogModalOpen ? <DialogFrame onClose={closeCatalogModal} busy={savingCatalog} className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"><form onSubmit={saveCatalogItem} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-text-main">{editingCatalogItem ? '编辑官方厨具' : '新增官方厨具'}</h2><button aria-label="关闭" type="button" disabled={savingCatalog} onClick={closeCatalogModal} className="text-text-muted"><X /></button></div><fieldset disabled={savingCatalog} className="space-y-4"><label className="block text-sm text-text-main">名称<input required value={catalogForm.name} onChange={(event) => setCatalogForm({ ...catalogForm, name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-primary" /></label><label className="block text-sm text-text-main">分类<select value={catalogForm.category} onChange={(event) => setCatalogForm({ ...catalogForm, category: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 outline-none focus:border-primary">{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label><label className="block text-sm text-text-main">别名（用顿号或逗号分隔）<input value={catalogForm.aliases} onChange={(event) => setCatalogForm({ ...catalogForm, aliases: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-primary" /></label><label className="block text-sm text-text-main">烹饪方式（用顿号或逗号分隔）<input value={catalogForm.cookingMethods} onChange={(event) => setCatalogForm({ ...catalogForm, cookingMethods: event.target.value })} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-primary" /></label><label className="block text-sm text-text-main">保养提示<textarea value={catalogForm.careNote} onChange={(event) => setCatalogForm({ ...catalogForm, careNote: event.target.value })} className="mt-1.5 min-h-20 w-full rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:border-primary" /></label></fieldset>{catalogSaveError && <p role="alert" className="mt-4 text-sm text-red-600">{catalogSaveError}</p>}<div className="mt-6 flex justify-end gap-3"><button type="button" disabled={savingCatalog} onClick={closeCatalogModal} className="rounded-xl px-4 py-2.5 text-sm text-text-muted">取消</button><button type="submit" disabled={savingCatalog} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white">保存</button></div></form></DialogFrame> : null}
    </div>
  );
}
