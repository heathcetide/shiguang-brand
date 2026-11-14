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
} from '@/components/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQueryState } from '@/hooks/useQueryState';
import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import api from '@/services/api';
import { Apple, PlusCircle, Check, X, Search, Trash2, Pencil, Filter, Database, Eye, Barcode } from 'lucide-react';
import { cn } from '@/utils/cn';
import { asAdminArray, asAdminPage } from '@/utils/adminResponses';
import { ingredientFormPayload, type IngredientForm } from './ingredientForm';
import { createLatestRequest } from '@/utils/latestRequest';

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
  const requestGuard = useRef(createLatestRequest());

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const hasActiveFilters = Boolean(serverSearch || selectedCategory !== '全部' || selectedSource !== '全部');
  const clearFilters = () => {
    setSearchQuery('');
    setServerSearch('');
    setSelectedCategory('全部');
    setSelectedSource('全部');
    setPage(1);
  };

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
    const request = requestGuard.current.begin();
    setLoading(true);
    try {
      if (activeTab === 'library') {
        const res = await api.get('/admin/ingredients', {
          params: {
            page,
            pageSize,
            search: serverSearch || undefined,
            category: selectedCategory === '全部' ? undefined : selectedCategory,
            source: selectedSource === '全部' ? undefined : selectedSource,
          },
          signal: request.signal,
        });
        if (!request.isLatest()) return;
        const pageData = asAdminPage(res.data, ['items', 'ingredients']);
        setLibrary(pageData.items);
        setTotal(pageData.total);
      } else {
        const res = await api.get('/admin/custom-foods/pending', { signal: request.signal });
        if (!request.isLatest()) return;
        setPendingUgc(asAdminArray(res.data, ['items']));
      }
    } catch (error) {
      if (!request.isLatest() || axios.isCancel(error)) return;
      console.error('Fetch error', error);
      showToast('获取数据失败', 'error');
    } finally {
      if (request.isLatest()) setLoading(false);
    }
  }, [activeTab, page, serverSearch, selectedCategory, selectedSource, showToast]);

  useEffect(() => {
    void fetchData();
    return () => requestGuard.current.cancel();
  }, [fetchData]);

  useEffect(() => {
    if (isComposing) return;
    const next = searchQuery.trim();
    const timer = window.setTimeout(() => {
      setServerSearch((prev) => {
        if (prev === next) return prev;
        setPage(1);
        return next;
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchQuery, isComposing]);

  const applySearchNow = () => {
    const next = searchQuery.trim();
    setServerSearch(next);
    setPage(1);
  };

  // Re-fetch library data in background
  const fetchLibrary = async () => {
    try {
      const res = await api.get('/admin/ingredients', {
        params: {
          page,
          pageSize,
          search: serverSearch || undefined,
          category: selectedCategory === '全部' ? undefined : selectedCategory,
          source: selectedSource === '全部' ? undefined : selectedSource,
        },
      });
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
    <div className="relative flex flex-col gap-5">
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
          <AdminButton type="button" variant="primary" onClick={openAddModal}>
            <PlusCircle className="size-4" />
            新增食材
          </AdminButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '标准食材收录', value: loading && !total ? '—' : String(total || library.length), icon: Apple },
          { label: '待审核 UGC', value: loading ? '—' : String(pendingUgc.length), icon: PlusCircle },
          { label: '食物大类', value: `${CATEGORIES.length - 1} 类`, icon: Filter },
          { label: '数据来源', value: `${Object.keys(SOURCE_LABELS).length} 来源`, icon: Database },
        ].map((stat) => (
          <Card key={stat.label} className="py-3">
            <CardContent className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
                <stat.icon className="size-5" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{stat.label}</p>
                <p className="text-foreground text-xl font-semibold tracking-tight">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'library' | 'ugc')}
      >
        <TabsList>
          <TabsTrigger value="library">官方标准库 ({total || library.length})</TabsTrigger>
          <TabsTrigger value="ugc" className="relative">
            用户提交审核 ({pendingUgc.length})
            {pendingUgc.length > 0 ? (
              <span className="bg-primary absolute -top-0.5 -right-0.5 size-2 rounded-full" aria-hidden />
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-4 space-y-4">
            <FilterBar className="items-stretch sm:items-end">
              <AdminField label="搜索" className="min-w-[220px] flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <AdminInput
                    className="pr-9 pl-10"
                    aria-label="搜索食材"
                    placeholder="名称、品牌或条码…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={(e) => {
                      setIsComposing(false);
                      setSearchQuery(e.currentTarget.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applySearchNow();
                      }
                    }}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      aria-label="清空搜索"
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1"
                      onClick={() => {
                        setSearchQuery('');
                        setServerSearch('');
                        setPage(1);
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </AdminField>
              <AdminField label="来源">
                <AdminSelect
                  value={selectedSource}
                  onChange={(e) => {
                    setSelectedSource(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="全部">全部来源</option>
                  <option value="taiwan_fda">台湾食药署</option>
                  <option value="open_food_facts">Open Food Facts</option>
                  <option value="usda_fdc_foundation">USDA</option>
                  <option value="system">系统</option>
                  <option value="official">官方验证</option>
                </AdminSelect>
              </AdminField>
              <div className="flex flex-wrap items-center gap-2">
                <AdminButton type="button" onClick={applySearchNow} disabled={loading}>
                  <Search className="size-3.5" />
                  查询
                </AdminButton>
                {hasActiveFilters ? (
                  <AdminButton type="button" onClick={clearFilters} disabled={loading}>
                    清除筛选
                  </AdminButton>
                ) : null}
              </div>
            </FilterBar>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="分类快捷筛选">
              {CATEGORIES.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={active}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}
                    onClick={() => {
                      setSelectedCategory(cat);
                      setPage(1);
                    }}
                  >
                    {cat === '全部' ? '全部分类' : cat}
                  </button>
                );
              })}
            </div>

            {hasActiveFilters ? (
              <p className="text-muted-foreground text-xs">
                {loading ? '正在查询…' : `当前筛选命中 ${total.toLocaleString()} 条`}
                {serverSearch ? ` · 关键词「${serverSearch}」` : ''}
                {selectedCategory !== '全部' ? ` · ${selectedCategory}` : ''}
                {selectedSource !== '全部' ? ` · ${SOURCE_LABELS[selectedSource] || selectedSource}` : ''}
              </p>
            ) : null}

            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <CardTitle>标准食材</CardTitle>
                <CardDescription>点击行查看营养详情；支持编辑与移入回收站。</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loading && library.length === 0 ? <EmptyState>加载中...</EmptyState> : null}
                {!loading && filteredLibrary.length === 0 ? <EmptyState>未找到匹配食材</EmptyState> : null}
                {filteredLibrary.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="min-w-[220px]">食材</TableHead>
                        <TableHead>分类 / 来源</TableHead>
                        <TableHead>热量</TableHead>
                        <TableHead className="whitespace-normal">三大营养素 / 100g</TableHead>
                        <TableHead>微量营养</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLibrary.map((item) => (
                        <TableRow
                          key={item.id}
                          className="cursor-pointer"
                          onClick={() => openDetailModal(item)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="bg-primary/10 flex size-9 shrink-0 items-center justify-center rounded-lg">
                                {item.image_url ? (
                                  <img src={item.image_url} alt={item.name} className="size-9 rounded-lg object-cover" />
                                ) : (
                                  <Apple className="text-primary size-4" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openDetailModal(item);
                                  }}
                                  className="text-foreground hover:text-primary block max-w-[240px] truncate text-left font-medium focus:underline focus:outline-none"
                                >
                                  {item.name}
                                </button>
                                {item.original_name && item.original_name !== item.name ? (
                                  <div className="text-muted-foreground max-w-[240px] truncate text-xs" title={item.original_name}>
                                    原名：{item.original_name}
                                  </div>
                                ) : null}
                                {item.brands ? <div className="text-muted-foreground max-w-[240px] truncate text-xs">{item.brands}</div> : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{item.category || '未分类'}</Badge>
                            <div className="text-muted-foreground mt-1 text-xs">{SOURCE_LABELS[item.source] || item.source}</div>
                          </TableCell>
                          <TableCell className="font-medium">
                            {item.calories_100g ?? '—'}{' '}
                            <span className="text-muted-foreground text-xs font-normal">kcal</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-normal text-xs">
                            碳 {item.carbs_100g == null ? '未知' : `${item.carbs_100g}g`}　蛋{' '}
                            {item.protein_100g == null ? '未知' : `${item.protein_100g}g`}　脂{' '}
                            {item.fat_100g == null ? '未知' : `${item.fat_100g}g`}
                          </TableCell>
                          <TableCell>
                            {item.micronutrients_json ? (
                              <Badge variant="outline" className="gap-1">
                                <Database size={12} /> 已收录
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">未收录</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openDetailModal(item);
                                }}
                                title="查看食材详情"
                              >
                                <Eye size={16} />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditModal(item);
                                }}
                                title="编辑食材"
                              >
                                <Pencil size={16} />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteIngredient(item.id, item.name);
                                }}
                                title="删除食材"
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </CardContent>
            </Card>
            {filteredLibrary.length > 0 ? (
              <AdminPagination page={page} pageSize={pageSize} total={total} disabled={loading} onChange={setPage} />
            ) : null}
        </TabsContent>

        <TabsContent value="ugc" className="mt-4 space-y-4">
            <FilterBar>
              <AdminField label="搜索" className="min-w-[200px] flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                  <Card key={item.id} className="py-0">
                    <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-4">
                        <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full">
                          <Apple className="size-5" />
                        </div>
                        <div>
                          <h3 className="text-foreground font-semibold">{item.name}</h3>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {item.calories_100g} kcal/100g • 提交人: {item.author_name || '匿名'}
                          </p>
                          <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
                            <span>碳: {item.carbs_100g}g</span>
                            <span>蛋: {item.protein_100g}g</span>
                            <span>脂: {item.fat_100g}g</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <AdminButton type="button" variant="primary" onClick={() => handleApprove(item.id)} title="通过审核并入库">
                          <Check className="size-4" />
                          通过
                        </AdminButton>
                        <AdminButton type="button" variant="danger" onClick={() => handleReject(item.id)} aria-label="拒绝" title="拒绝">
                          <X className="size-4" />
                          拒绝
                        </AdminButton>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : null}
        </TabsContent>
      </Tabs>

      {/* Ingredient Detail Modal */}
      {selectedIngredient && (
        <DialogFrame onClose={()=>setSelectedIngredient(null)} busy={false}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"

        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ingredient-detail-title"
            className="bg-card text-card-foreground rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl ring-1 ring-foreground/10 animate-in fade-in zoom-in-95 duration-150"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-card/95 backdrop-blur border-b border-border rounded-t-3xl">
              <div>
                <p className="text-xs font-medium text-primary mb-1">食材详情</p>
                <h3 id="ingredient-detail-title" className="text-xl font-bold text-foreground">
                  {selectedIngredient.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIngredient(null)}
                className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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
                    <div className="rounded-2xl bg-muted p-4">
                      <p className="text-xs text-muted-foreground mb-1">分类</p>
                      <p className="text-base font-semibold text-foreground">
                        {selectedIngredient.category || '未分类'}
                      </p>
                    </div>
                  </div>
                  <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">数据来源</dt>
                      <dd className="font-medium text-foreground mt-0.5">
                        {SOURCE_LABELS[selectedIngredient.source] || selectedIngredient.source || '未知'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">品牌</dt>
                      <dd className="font-medium text-foreground mt-0.5">{selectedIngredient.brands || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">原始名称</dt>
                      <dd className="font-medium text-foreground mt-0.5 break-words">
                        {selectedIngredient.original_name || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">数据许可</dt>
                      <dd className="font-medium text-foreground mt-0.5">{selectedIngredient.data_license || '—'}</dd>
                    </div>
                  </dl>
                  {selectedIngredient.barcode && (
                    <div className="inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                      <Barcode size={16} />
                      <span className="font-mono">{selectedIngredient.barcode}</span>
                    </div>
                  )}
                </div>
              </div>

              <section>
                <h4 className="font-semibold text-foreground mb-3">三大营养素</h4>
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
                <h4 className="font-semibold text-foreground mb-3">微量营养素</h4>
                {parseMicronutrients(selectedIngredient.micronutrients_json).length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {parseMicronutrients(selectedIngredient.micronutrients_json).map((nutrient) => (
                      <div key={nutrient.key} className="rounded-xl border border-border bg-muted/70 px-3 py-2.5">
                        <p className="text-xs text-muted-foreground">{nutrient.label}</p>
                        <p className="font-semibold text-foreground mt-0.5">
                          {nutrient.value} <span className="text-xs font-normal text-muted-foreground">{nutrient.unit}/100g</span>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-muted py-6 text-center text-sm text-muted-foreground">
                    暂无微量营养素数据
                  </div>
                )}
              </section>
            </div>

            <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 px-6 py-4 bg-card/95 backdrop-blur border-t border-border rounded-b-3xl">
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
          <div className="bg-card text-card-foreground rounded-3xl p-6 w-full max-w-lg shadow-xl ring-1 ring-foreground/10 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
              <h3 className="text-lg font-bold text-foreground">
                {modalMode === 'add' ? '新增官方标准食材' : '编辑食材'}
              </h3>
              <button aria-label="关闭"
                onClick={() => setShowModal(false)}
                className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <p className="text-xs text-muted-foreground">营养值留空表示未知，只有确认含量为零时才填 0。缺项会标记待审核；填写完整不代表来源已验证。</p>
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

              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
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
