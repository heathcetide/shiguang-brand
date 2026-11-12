import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminPagination,
  AdminSelect,
  DialogFrame,
  EmptyState,
  FilterBar,
  PageHeader,
  TableContainer,
} from '../components/admin';
import { useQueryState } from '../hooks/useQueryState';
import { useCallback, useState, useEffect } from 'react';
import api from '../services/api';
import { Apple, PlusCircle, Check, X, Search, Trash2, Pencil, Filter, Database, Eye, Barcode } from 'lucide-react';
import { cn } from '../utils/cn';
import { asAdminArray, asAdminPage } from '../utils/adminResponses';
import { ingredientFormPayload, type IngredientForm } from './ingredientForm';

const CATEGORIES = ['全部', '肉类', '蔬菜', '水果', '谷物', '乳制品', '海鲜', '豆制品', '其他'];

const SOURCE_LABELS: Record<string, string> = {
  official: '官方验证',
  system: '系统内置',
  open_food_facts: 'Open Food Facts',
  taiwan_fda: '台湾食药署',
  usda: 'USDA',
  usda_fdc_foundation: 'USDA FoodData Central',
  cn_food: '中国食物成分表',
};

const NUTRIENT_LABELS: Record<string, string> = {
  sugars: '糖',
  fiber: '膳食纤维',
  salt: '盐',
  sodium: '钠',
  calcium: '钙',
  iron: '铁',
  potassium: '钾',
  cholesterol: '胆固醇',
  'saturated-fat': '饱和脂肪',
  'trans-fat': '反式脂肪',
  'vitamin-a': '维生素 A',
  'vitamin-c': '维生素 C',
  'vitamin-d': '维生素 D',
};

function parseMicronutrients(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Record<string, { value?: number; unit?: string } | number>;
    return Object.entries(parsed)
      .map(([key, nutrient]) => {
        const amount = typeof nutrient === 'number' ? nutrient : nutrient?.value;
        const unit = typeof nutrient === 'number' ? 'g' : nutrient?.unit || 'g';
        return {
          key,
          label: NUTRIENT_LABELS[key] || key.replaceAll('-', ' '),
          value: amount,
          unit,
        };
      })
      .filter((nutrient) => typeof nutrient.value === 'number' && Number.isFinite(nutrient.value));
  } catch {
    return [];
  }
}

export default function Ingredients() {
  const [activeTab, setActiveTab] = useQueryState<'library' | 'ugc'>('tab', 'library', ["library", "ugc"]);
  const [library, setLibrary] = useState<any[]>([]);
  const [pendingUgc, setPendingUgc] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useQueryState<string>('q', '');
  const [serverSearch, setServerSearch] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useQueryState<string>('category', '全部', ["全部", "肉类", "蔬菜", "水果", "谷物", "乳制品", "海鲜", "豆制品", "其他"]);
  const [selectedSource, setSelectedSource] = useQueryState<string>('source', '全部', ["全部", "taiwan_fda", "open_food_facts", "usda_fdc_foundation", "system"]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIngredient, setSelectedIngredient] = useState<any | null>(null);

  const initialForm = {
    name: '',
    category: '其他',
    calories_100g: '',
    protein_100g: '',
    carbs_100g: '',
    fat_100g: '',
    source: 'official',
  };

  const [formData, setFormData] = useState(initialForm);
  const [originalForm, setOriginalForm] = useState<IngredientForm>();

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'library') {
        const res = await api.get('/admin/ingredients', { params: { page, pageSize, search: serverSearch || undefined, category: selectedCategory, source: selectedSource } });
        const pageData = asAdminPage(res.data, ['items', 'ingredients']);
        setLibrary(pageData.items);
        setTotal(pageData.total);
      } else {
        const res = await api.get('/admin/custom-foods/pending');
        setPendingUgc(asAdminArray(res.data, ['items']));
      }
    } catch (error) {
      console.error('Fetch error', error);
      showToast('获取数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, serverSearch, selectedCategory, selectedSource, showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => {
      setServerSearch(searchQuery.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchQuery, isComposing]);

  // Re-fetch library data in background
  const fetchLibrary = async () => {
    try {
      const res = await api.get('/admin/ingredients', { params: { page, pageSize, search: serverSearch || undefined, category: selectedCategory, source: selectedSource } });
      const pageData = asAdminPage(res.data, ['items', 'ingredients']);
      setLibrary(pageData.items);
      setTotal(pageData.total);
    } catch (e) {
      console.error(e);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/admin/custom-foods/${id}/approve`);
      setPendingUgc((prev) => prev.filter((item) => item.id !== id));
      showToast('已通过审核并入库', 'success');
      // Fetch library so switching tabs shows it
      fetchLibrary();
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handleReject = async (id: number) => {
    if (!window.confirm('确定要拒绝该数据吗？')) return;
    try {
      await api.post(`/admin/custom-foods/${id}/reject`);
      setPendingUgc((prev) => prev.filter((item) => item.id !== id));
      showToast('已拒绝', 'success');
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handleDeleteIngredient = async (id: number, name: string) => {
    if (!window.confirm(`确定要将食材【${name}】移入回收站吗？之后可以恢复。`)) return;
    try {
      await api.delete(`/admin/ingredients/${id}`);
      setLibrary((prev) => prev.filter((item) => item.id !== id));
      showToast('已移入回收站', 'success');
    } catch {
      showToast('删除失败', 'error');
    }
  };

  const openAddModal = () => {
    setModalMode('add');
    setFormData(initialForm);
    setOriginalForm(undefined);
    setShowModal(true);
  };

  const openEditModal = (item: any) => {
    setModalMode('edit');
    setEditingId(item.id);
    const form = {
      name: item.name || '',
      category: item.category || '其他',
      calories_100g: item.calories_100g?.toString() || '',
      protein_100g: item.protein_100g?.toString() || '',
      carbs_100g: item.carbs_100g?.toString() || '',
      fat_100g: item.fat_100g?.toString() || '',
      source: item.source || 'official',
    };
    setFormData(form);
    setOriginalForm(form);
    setShowModal(true);
  };

  const openDetailModal = (item: any) => {
    setSelectedIngredient(item);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showToast('请输入食材名称', 'error');
      return;
    }
    try {
      setSubmitting(true);
      const payload = ingredientFormPayload(formData, modalMode === 'edit' ? originalForm : undefined);

      if (modalMode === 'add') {
        await api.post('/admin/ingredients', payload);
        showToast('新增食材成功！', 'success');
      } else {
        await api.put(`/admin/ingredients/${editingId}`, payload);
        showToast('修改食材成功！', 'success');
      }

      setShowModal(false);
      if (activeTab === 'library') {
        fetchData();
      } else {
        fetchLibrary();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || err.message || (modalMode === 'add' ? '添加失败' : '修改失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered List
  const filteredLibrary = library;

  const filteredPending = pendingUgc.filter((item) =>
    item.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="admin-stack relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4">
          <div
            className={cn(
              "px-6 py-3 rounded-full shadow-lg flex items-center space-x-2 text-sm font-medium",
              toast.type === 'success'
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            )}
          >
            {toast.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      <PageHeader
        title="食材库"
        description="管理官方标准食物营养成分库及用户自定义提交的待审核食材"
        actions={
          <div className="admin-actions">
            <AdminButton
              type="button"
              variant={activeTab === 'library' ? 'primary' : 'default'}
              onClick={() => setActiveTab('library')}
            >
              官方标准库 ({total || library.length})
            </AdminButton>
            <AdminButton
              type="button"
              variant={activeTab === 'ugc' ? 'primary' : 'default'}
              onClick={() => setActiveTab('ugc')}
              className="relative"
            >
              用户提交审核 ({pendingUgc.length})
              {pendingUgc.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                </span>
              )}
            </AdminButton>
          </div>
        }
      />

      {/* Top Metric Summary Cards */}
      <div className="admin-stat-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">标准食材收录</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{loading && !total ? '—' : (total || library.length)}</p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Apple className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">待审核 UGC 食材</p>
            <p className="mt-1.5 text-2xl font-bold text-orange-600">{loading ? '—' : pendingUgc.length}</p>
          </div>
          <div className="rounded-2xl bg-orange-50 p-3 text-orange-600">
            <PlusCircle className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">涵盖食物大类</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{CATEGORIES.length - 1} 类</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
            <Filter className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">权威数据来源</p>
            <p className="mt-1.5 text-2xl font-bold text-blue-600">{Object.keys(SOURCE_LABELS).length} 来源</p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
            <Database className="h-6 w-6" />
          </div>
        </div>
      </div>

      <section className="admin-panel space-y-4">
        {activeTab === 'library' ? (
          <>
            <FilterBar>
              <AdminField label="搜索" className="min-w-[200px] flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <AdminInput
                    className="pl-10"
                    placeholder="搜索食材名称..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={(e) => { setIsComposing(false); setSearchQuery(e.currentTarget.value); }}
                  />
                </div>
              </AdminField>
              <AdminField label="分类">
                <AdminSelect value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setPage(1); }}>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </AdminSelect>
              </AdminField>
              <AdminField label="来源">
                <AdminSelect value={selectedSource} onChange={(e) => { setSelectedSource(e.target.value); setPage(1); }}>
                  <option value="全部">全部来源</option>
                  <option value="taiwan_fda">台湾食药署</option>
                  <option value="open_food_facts">Open Food Facts</option>
                  <option value="usda_fdc_foundation">USDA</option>
                  <option value="system">系统</option>
                </AdminSelect>
              </AdminField>
              <AdminButton type="button" variant="primary" onClick={openAddModal}>
                <PlusCircle className="h-5 w-5" />
                <span>新增食材</span>
              </AdminButton>
            </FilterBar>

            <TableContainer>
              {loading && library.length === 0 ? <EmptyState>加载中...</EmptyState> : null}
              {!loading && filteredLibrary.length === 0 ? <EmptyState>未找到匹配食材</EmptyState> : null}
              {filteredLibrary.length > 0 ? (
                <table className="admin-table min-w-[920px]">
                  <thead>
                    <tr>
                      <th className="min-w-[220px]">食材</th>
                      <th className="min-w-[130px]">分类 / 来源</th>
                      <th className="min-w-[100px]">热量</th>
                      <th className="min-w-[220px]">三大营养素 / 100g</th>
                      <th className="min-w-[120px]">微量营养</th>
                      <th className="min-w-[110px] text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLibrary.map((item) => (
                      <tr
                        key={item.id}
                        className="cursor-pointer hover:bg-primary/[0.04] focus-within:bg-primary/[0.04]"
                        onClick={() => openDetailModal(item)}
                      >
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                              {item.image_url ? (
                                <img src={item.image_url} alt={item.name} className="h-9 w-9 rounded-lg object-cover" />
                              ) : (
                                <Apple className="h-4 w-4 text-primary" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); openDetailModal(item); }}
                                className="block max-w-[240px] truncate text-left font-medium text-text-main hover:text-primary focus:underline focus:outline-none"
                              >
                                {item.name}
                              </button>
                              {item.original_name && item.original_name !== item.name ? (
                                <div className="max-w-[240px] truncate text-xs text-text-muted" title={item.original_name}>
                                  原名：{item.original_name}
                                </div>
                              ) : null}
                              {item.brands ? <div className="max-w-[240px] truncate text-xs text-text-muted">{item.brands}</div> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div>{item.category || '未分类'}</div>
                          <div className="mt-1 text-xs text-text-muted">{item.source}</div>
                        </td>
                        <td className="font-medium">
                          {item.calories_100g ?? '—'}{' '}
                          <span className="text-xs font-normal text-text-muted">kcal</span>
                        </td>
                        <td className="text-text-muted">
                          碳 {item.carbs_100g == null ? '未知' : `${item.carbs_100g}g`}　蛋 {item.protein_100g == null ? '未知' : `${item.protein_100g}g`}　脂 {item.fat_100g == null ? '未知' : `${item.fat_100g}g`}
                        </td>
                        <td>
                          {item.micronutrients_json ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                              <Database size={12} /> 已收录
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">未收录</span>
                          )}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); openDetailModal(item); }}
                              className="rounded-lg p-2 text-text-muted transition-all hover:bg-primary/10 hover:text-primary"
                              title="查看食材详情"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); openEditModal(item); }}
                              className="rounded-lg p-2 text-text-muted transition-all hover:bg-primary/10 hover:text-primary"
                              title="编辑食材"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); handleDeleteIngredient(item.id, item.name); }}
                              className="rounded-lg p-2 text-text-muted transition-all hover:bg-red-50 hover:text-red-500"
                              title="删除食材"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </TableContainer>
            {filteredLibrary.length > 0 ? (
              <AdminPagination page={page} pageSize={pageSize} total={total} disabled={loading} onChange={setPage} />
            ) : null}
          </>
        ) : (
          <>
            <FilterBar>
              <AdminField label="搜索" className="min-w-[200px] flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <AdminInput
                    className="pl-10"
                    placeholder="搜索待审核食材..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </AdminField>
            </FilterBar>
            {loading ? <EmptyState>加载中...</EmptyState> : null}
            {!loading && filteredPending.length === 0 ? <EmptyState>暂无待审核的食材</EmptyState> : null}
            {!loading && filteredPending.length > 0 ? (
              <div className="space-y-3">
                {filteredPending.map((item) => (
                  <div key={item.id} className="admin-panel flex items-center justify-between !p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
                        <Apple className="h-5 w-5 text-orange-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-text-main">{item.name}</h3>
                        <p className="mt-1 text-sm text-text-muted">
                          {item.calories_100g} kcal/100g • 提交人: {item.author_name || '匿名'}
                        </p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
                          <span>碳: {item.carbs_100g}g</span>
                          <span>蛋: {item.protein_100g}g</span>
                          <span>脂: {item.fat_100g}g</span>
                        </div>
                      </div>
                    </div>
                    <div className="admin-actions">
                      <AdminButton type="button" variant="primary" onClick={() => handleApprove(item.id)} title="通过审核并入库">
                        <Check className="h-4 w-4" />
                      </AdminButton>
                      <AdminButton type="button" variant="danger" onClick={() => handleReject(item.id)} aria-label="拒绝" title="拒绝">
                        <X className="h-4 w-4" />
                      </AdminButton>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* Ingredient Detail Modal */}
      {selectedIngredient && (
        <DialogFrame onClose={()=>setSelectedIngredient(null)} busy={false}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"

        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ingredient-detail-title"
            className="bg-white rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-white/95 backdrop-blur border-b border-gray-100 rounded-t-3xl">
              <div>
                <p className="text-xs font-medium text-primary mb-1">食材详情</p>
                <h3 id="ingredient-detail-title" className="text-xl font-bold text-gray-900">
                  {selectedIngredient.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIngredient(null)}
                className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 p-2 rounded-xl transition-colors"
                aria-label="关闭食材详情"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid md:grid-cols-[180px_1fr] gap-6">
                <div className="w-full aspect-square rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center overflow-hidden">
                  {selectedIngredient.image_url ? (
                    <img
                      src={selectedIngredient.image_url}
                      alt={selectedIngredient.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Apple className="w-16 h-16 text-primary/50" />
                  )}
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-orange-50 p-4">
                      <p className="text-xs text-orange-600 mb-1">每 100g 热量</p>
                      <p className="text-2xl font-bold text-orange-700">
                        {selectedIngredient.calories_100g ?? '—'}
                        <span className="ml-1 text-sm font-medium">kcal</span>
                      </p>
                    </div>
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <p className="text-xs text-gray-500 mb-1">分类</p>
                      <p className="text-base font-semibold text-gray-800">
                        {selectedIngredient.category || '未分类'}
                      </p>
                    </div>
                  </div>
                  <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <dt className="text-gray-400">数据来源</dt>
                      <dd className="font-medium text-gray-700 mt-0.5">
                        {SOURCE_LABELS[selectedIngredient.source] || selectedIngredient.source || '未知'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">品牌</dt>
                      <dd className="font-medium text-gray-700 mt-0.5">{selectedIngredient.brands || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">原始名称</dt>
                      <dd className="font-medium text-gray-700 mt-0.5 break-words">
                        {selectedIngredient.original_name || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">数据许可</dt>
                      <dd className="font-medium text-gray-700 mt-0.5">{selectedIngredient.data_license || '—'}</dd>
                    </div>
                  </dl>
                  {selectedIngredient.barcode && (
                    <div className="inline-flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      <Barcode size={16} />
                      <span className="font-mono">{selectedIngredient.barcode}</span>
                    </div>
                  )}
                </div>
              </div>

              <section>
                <h4 className="font-semibold text-gray-900 mb-3">三大营养素</h4>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: '碳水化合物', value: selectedIngredient.carbs_100g, color: 'bg-amber-50 text-amber-700' },
                    { label: '蛋白质', value: selectedIngredient.protein_100g, color: 'bg-blue-50 text-blue-700' },
                    { label: '脂肪', value: selectedIngredient.fat_100g, color: 'bg-rose-50 text-rose-700' },
                  ].map((nutrient) => (
                    <div key={nutrient.label} className={cn('rounded-2xl p-4', nutrient.color)}>
                      <p className="text-xs opacity-75">{nutrient.label}</p>
                      <p className="text-xl font-bold mt-1">
                        {nutrient.value ?? '未知'}{nutrient.value != null && <span className="text-xs font-medium ml-1">g/100g</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="font-semibold text-gray-900 mb-3">微量营养素</h4>
                {parseMicronutrients(selectedIngredient.micronutrients_json).length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {parseMicronutrients(selectedIngredient.micronutrients_json).map((nutrient) => (
                      <div key={nutrient.key} className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5">
                        <p className="text-xs text-gray-500">{nutrient.label}</p>
                        <p className="font-semibold text-gray-800 mt-0.5">
                          {nutrient.value} <span className="text-xs font-normal text-gray-500">{nutrient.unit}/100g</span>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-gray-50 py-6 text-center text-sm text-gray-400">
                    暂无微量营养素数据
                  </div>
                )}
              </section>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 px-6 py-4 bg-white/95 backdrop-blur border-t border-gray-100 rounded-b-3xl admin-actions">
              <AdminButton type="button" onClick={() => setSelectedIngredient(null)}>
                关闭
              </AdminButton>
              <AdminButton
                type="button"
                variant="primary"
                onClick={() => {
                  const item = selectedIngredient;
                  setSelectedIngredient(null);
                  openEditModal(item);
                }}
              >
                <Pencil size={15} />
                编辑食材
              </AdminButton>
            </div>
          </div>
        </DialogFrame>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <DialogFrame onClose={()=>setShowModal(false)} busy={submitting} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
              <h3 className="text-lg font-bold text-gray-900">
                {modalMode === 'add' ? '新增官方标准食材' : '编辑食材'}
              </h3>
              <button aria-label="关闭"
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <p className="text-xs text-text-muted">营养值留空表示未知，只有确认含量为零时才填 0。缺项会标记待审核；填写完整不代表来源已验证。</p>
              <div className="grid grid-cols-2 gap-3">
                <AdminField label="食材名称 *">
                  <AdminInput
                    required
                    placeholder="例如：鸡胸肉"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </AdminField>
                <AdminField label="分类">
                  <AdminSelect
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  >
                    {CATEGORIES.slice(1).map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </AdminSelect>
                </AdminField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <AdminField label="热量 (kcal/100g)">
                  <AdminInput
                    type="number"
                    step="any"
                    min="0"
                    max="1000"
                    placeholder="未知可留空"
                    value={formData.calories_100g}
                    onChange={(e) => setFormData({ ...formData, calories_100g: e.target.value })}
                  />
                </AdminField>
                <AdminField label="来源属性">
                  <AdminSelect
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                  >
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    {!SOURCE_LABELS[formData.source] && <option value={formData.source}>{formData.source}</option>}
                  </AdminSelect>
                </AdminField>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <AdminField label="碳水化合物 (g)">
                  <AdminInput
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    placeholder="未知可留空"
                    value={formData.carbs_100g}
                    onChange={(e) => setFormData({ ...formData, carbs_100g: e.target.value })}
                  />
                </AdminField>
                <AdminField label="蛋白质 (g)">
                  <AdminInput
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    placeholder="未知可留空"
                    value={formData.protein_100g}
                    onChange={(e) => setFormData({ ...formData, protein_100g: e.target.value })}
                  />
                </AdminField>
                <AdminField label="脂肪 (g)">
                  <AdminInput
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    placeholder="未知可留空"
                    value={formData.fat_100g}
                    onChange={(e) => setFormData({ ...formData, fat_100g: e.target.value })}
                  />
                </AdminField>
              </div>

              <div className="admin-actions justify-end border-t border-border pt-4">
                <AdminButton type="button" onClick={() => setShowModal(false)}>取消</AdminButton>
                <AdminButton type="submit" variant="primary" disabled={submitting}>
                  {submitting ? '提交中...' : (modalMode === 'add' ? '确定添加' : '保存修改')}
                </AdminButton>
              </div>
            </form>
          </div>
        </DialogFrame>
      )}
    </div>
  );
}
