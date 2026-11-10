import { DialogFrame } from '../components/admin/DialogFrame';
import { useQueryState } from '../hooks/useQueryState';
import { useCallback, useState, useEffect } from 'react';
import api from '../services/api';
import { Apple, PlusCircle, Check, X, Search, Trash2, Pencil, Filter, ChevronLeft, ChevronRight, Database, Eye, Barcode } from 'lucide-react';
import { cn } from '../utils/cn';
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
        setLibrary(res.data.items);
        setTotal(res.data.total);
      } else {
        const res = await api.get('/admin/custom-foods/pending');
        setPendingUgc(res.data);
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
      setLibrary(res.data.items);
      setTotal(res.data.total);
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
    <div className="space-y-6 relative">
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

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
            <Apple className="w-7 h-7 text-primary" />
            食材库
          </h1>
          <p className="text-xs text-text-muted mt-1">管理官方标准食物营养成分库及用户自定义提交的待审核食材</p>
        </div>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-medium transition-colors shadow-sm",
              activeTab === 'library'
                ? 'bg-primary text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'
            )}
          >
            官方标准库 ({total || library.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ugc')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-medium transition-colors shadow-sm relative",
              activeTab === 'ugc'
                ? 'bg-primary text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'
            )}
          >
            用户提交审核 ({pendingUgc.length})
            {pendingUgc.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Top Metric Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        {loading && activeTab === 'library' && library.length === 0 ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : activeTab === 'library' ? (
          <div>
            <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4 mb-6">
              <div className="relative flex-1 w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索食材名称..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={(e) => { setIsComposing(false); setSearchQuery(e.currentTarget.value); }}
                  className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-primary/20 text-sm"
                />
              </div>

              <div className="flex items-center space-x-2 bg-gray-50 rounded-xl px-3 py-1 w-full sm:w-auto">
                <Filter className="w-4 h-4 text-gray-400" />
                <select
                  value={selectedCategory}
                  onChange={(e) => { setSelectedCategory(e.target.value); setPage(1); }}
                  className="bg-transparent border-none focus:ring-0 text-sm text-gray-700 py-1.5 w-full sm:w-auto outline-none cursor-pointer"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <select value={selectedSource} onChange={(e) => { setSelectedSource(e.target.value); setPage(1); }} className="bg-gray-50 border-none rounded-xl px-3 py-2 text-sm text-gray-700 outline-none cursor-pointer">
                <option value="全部">全部来源</option><option value="taiwan_fda">台湾食药署</option><option value="open_food_facts">Open Food Facts</option><option value="usda_fdc_foundation">USDA</option><option value="system">系统</option>
              </select>

              <button
                onClick={openAddModal}
                className="flex items-center space-x-2 px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium w-full sm:w-auto justify-center"
              >
                <PlusCircle className="w-5 h-5" />
                <span>新增食材</span>
              </button>
            </div>

            {filteredLibrary.length === 0 ? (
              <div className="text-center py-12 text-gray-400">未找到匹配食材</div>
            ) : (
              <>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 font-medium min-w-[220px] whitespace-nowrap">食材</th>
                      <th className="px-4 py-3 font-medium min-w-[130px] whitespace-nowrap">分类 / 来源</th>
                      <th className="px-4 py-3 font-medium min-w-[100px] whitespace-nowrap">热量</th>
                      <th className="px-4 py-3 font-medium min-w-[220px] whitespace-nowrap">三大营养素 / 100g</th>
                      <th className="px-4 py-3 font-medium min-w-[120px] whitespace-nowrap">微量营养</th>
                      <th className="px-4 py-3 font-medium text-right min-w-[110px] whitespace-nowrap">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                {filteredLibrary.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-primary/[0.04] cursor-pointer transition-colors focus-within:bg-primary/[0.04]"
                    onClick={() => openDetailModal(item)}
                  >
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">{item.image_url ? <img src={item.image_url} alt={item.name} className="w-9 h-9 rounded-lg object-cover" /> : <Apple className="w-4 h-4 text-primary" />}</div><div className="min-w-0"><button type="button" onClick={(event) => { event.stopPropagation(); openDetailModal(item); }} className="font-medium text-text-main hover:text-primary text-left max-w-[240px] truncate block focus:outline-none focus:underline">{item.name}</button>{item.original_name && item.original_name !== item.name && <div className="text-xs text-gray-400 truncate max-w-[240px]" title={item.original_name}>原名：{item.original_name}</div>}{item.brands && <div className="text-xs text-gray-400 truncate max-w-[240px]">{item.brands}</div>}</div></div></td>
                    <td className="px-4 py-3 whitespace-nowrap"><div className="whitespace-nowrap">{item.category || '未分类'}</div><div className="text-xs text-gray-400 mt-1 whitespace-nowrap">{item.source}</div></td><td className="px-4 py-3 font-medium whitespace-nowrap">{item.calories_100g ?? '—'} <span className="text-xs font-normal text-gray-400">kcal</span></td><td className="px-4 py-3 text-gray-600 whitespace-nowrap">碳 {item.carbs_100g == null ? '未知' : `${item.carbs_100g}g`}　蛋 {item.protein_100g == null ? '未知' : `${item.protein_100g}g`}　脂 {item.fat_100g == null ? '未知' : `${item.fat_100g}g`}</td><td className="px-4 py-3 whitespace-nowrap">{item.micronutrients_json ? <span className="inline-flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-1 rounded-full whitespace-nowrap"><Database size={12} /> 已收录</span> : <span className="text-xs text-gray-400 whitespace-nowrap">未收录</span>}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1">
                      <button
                        onClick={(event) => { event.stopPropagation(); openDetailModal(item); }}
                        className="p-2 text-gray-400 hover:text-primary transition-all rounded-lg hover:bg-primary/10"
                        title="查看食材详情"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={(event) => { event.stopPropagation(); openEditModal(item); }}
                        className="p-2 text-gray-400 hover:text-primary transition-all rounded-lg hover:bg-primary/10"
                        title="编辑食材"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={(event) => { event.stopPropagation(); handleDeleteIngredient(item.id, item.name); }}
                        className="p-2 text-gray-400 hover:text-red-500 transition-all rounded-lg hover:bg-red-50"
                        title="删除食材"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div></td></tr>
                ))}
                  </tbody></table>
              </div>
              <div className="flex items-center justify-between pt-4 text-sm text-gray-500"><span>显示 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / 共 {total} 条</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="p-2 rounded-lg border disabled:opacity-40"><ChevronLeft size={16}/></button><span className="px-2 py-2">第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页</span><button disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(page + 1)} className="p-2 rounded-lg border disabled:opacity-40"><ChevronRight size={16}/></button></div></div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative max-w-md mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="搜索待审核食材..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-primary/20 text-sm"
              />
            </div>
            {filteredPending.length === 0 ? (
              <div className="text-center py-12 text-gray-500">暂无待审核的食材</div>
            ) : (
              filteredPending.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 rounded-2xl border border-gray-100 bg-gray-50/50"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                      <Apple className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-main">{item.name}</h3>
                      <p className="text-sm text-text-muted mt-1">
                        {item.calories_100g} kcal/100g • 提交人: {item.author_name || '匿名'}
                      </p>
                      <div className="flex items-center space-x-3 mt-1 text-xs text-gray-400">
                        <span>碳: {item.carbs_100g}g</span>
                        <span>蛋: {item.protein_100g}g</span>
                        <span>脂: {item.fat_100g}g</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleApprove(item.id)}
                      className="w-10 h-10 rounded-full bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-colors"
                      title="通过审核并入库"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    <button aria-label="关闭"
                      onClick={() => handleReject(item.id)}
                      className="w-10 h-10 rounded-full bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center transition-colors"
                      title="拒绝"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

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

            <div className="sticky bottom-0 flex justify-end gap-3 px-6 py-4 bg-white/95 backdrop-blur border-t border-gray-100 rounded-b-3xl">
              <button
                type="button"
                onClick={() => setSelectedIngredient(null)}
                className="px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-100 text-sm font-medium"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => {
                  const item = selectedIngredient;
                  setSelectedIngredient(null);
                  openEditModal(item);
                }}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-medium"
              >
                <Pencil size={15} />
                编辑食材
              </button>
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
              <p className="text-xs text-gray-500">营养值留空表示未知，只有确认含量为零时才填 0。缺项会标记待审核；填写完整不代表来源已验证。</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">食材名称 *</label>
                  <input
                    type="text"
                    required
                    placeholder="例如：鸡胸肉"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">分类</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  >
                    {CATEGORIES.slice(1).map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">热量 (kcal/100g)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="1000"
                    placeholder="未知可留空"
                    value={formData.calories_100g}
                    onChange={(e) =>
                      setFormData({ ...formData, calories_100g: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">来源属性</label>
                  <select
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  >
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    {!SOURCE_LABELS[formData.source] && <option value={formData.source}>{formData.source}</option>}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">碳水化合物 (g)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    placeholder="未知可留空"
                    value={formData.carbs_100g}
                    onChange={(e) => setFormData({ ...formData, carbs_100g: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">蛋白质 (g)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    placeholder="未知可留空"
                    value={formData.protein_100g}
                    onChange={(e) =>
                      setFormData({ ...formData, protein_100g: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">脂肪 (g)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    placeholder="未知可留空"
                    value={formData.fat_100g}
                    onChange={(e) => setFormData({ ...formData, fat_100g: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-100 text-sm font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? '提交中...' : (modalMode === 'add' ? '确定添加' : '保存修改')}
                </button>
              </div>
            </form>
          </div>
        </DialogFrame>
      )}
    </div>
  );
}
