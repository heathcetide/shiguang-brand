import { AdminButton, AdminField, AdminInput, AdminPagination, AdminSelect, AdminTextarea, DetailPanel, DialogFrame, EmptyState, FilterBar, PageHeader, StatusBadge, TableContainer } from '../components/admin';
import { RecipeProvenancePanel, type RecipeProvenance } from './RecipeProvenancePanel';
import { RecipeExecutionEditor } from './RecipeExecutionEditor';
import { useQueryState } from '../hooks/useQueryState';
import React, { useCallback, useEffect, useState, useMemo, useRef, useLayoutEffect } from 'react';
import {
  Minus,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import api from '../services/api';
import { cn } from '../utils/cn';
import { asAdminPage } from '../utils/adminResponses';
import { parseRecipeArray, qualityIssueText, recipeStatusText, recipeNutritionPayload } from './recipeReviewModel';

type Recipe = RecipeProvenance & {
  id: number;
  title: string;
  category: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  cook_time?: string | number;
  prep_time?: number | null;
  difficulty?: string;
  image_url: string;
  description?: string;
  tags?: string;
  steps_json?: string | string[];
  ingredients_json?: string | Ingredient[];
  source?: string;
  status?: 'pending' | 'approved' | 'rejected';
  author_username?: string;
  reject_reason?: string;
  quality_status?: 'trusted' | 'estimated' | 'needs_review';
  nutrition_basis?: string | null;
  quality_issues_json?: string | string[];
  quality_review_reason?: string;
};

type Ingredient = {
  name: string;
  amount: string;
};

type RecipeFormState = {
  title: string;
  category: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  cook_time: string;
  prep_time: string;
  difficulty: string;
  image_url: string;
  description: string;
  steps: string[];
  ingredients: Ingredient[];
};

const CATEGORIES = ['全部', '减脂', '增肌', '营养餐单', '快手菜'];
const DIFFICULTIES = ['简单', '中等', '较难'];
const INITIAL_FORM_STATE: RecipeFormState = {
  title: '',
  category: '减脂餐',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  cook_time: '',
  prep_time: '',
  difficulty: '简单',
  image_url: '',
  description: '',
  steps: [''],
  ingredients: [{ name: '', amount: '' }],
};

function recipeDetailArray<T>(value: string | T[] | undefined): T[] { try { return parseRecipeArray<T>(value); } catch { return []; } }

export default function Recipes() {
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [loadError, setLoadError] = useState('');
  const requestId = useRef(0);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useQueryState<string>('q', '');
  const [activeCategory, setActiveCategory] = useQueryState<string>('category', '全部', CATEGORIES);
  const [sourceFilter, setSourceFilter] = useQueryState<'all' | 'official' | 'user'>('source', 'all', ["all", "official", "user"]);
  const [reviewStatus, setReviewStatus] = useQueryState<'all' | 'pending' | 'approved' | 'rejected'>('reviewStatus', 'all', ["all", "pending", "approved", "rejected"]);
  const [qualityStatus, setQualityStatus] = useQueryState<'all' | 'trusted' | 'estimated' | 'needs_review'>('qualityStatus', 'all', ["all", "trusted", "estimated", "needs_review"]);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [totalRecipes, setTotalRecipes] = useState(0);
  const [summary, setSummary] = useState({ platform: 0, user: 0, pending: 0, needsReview: 0 });

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<RecipeFormState>(INITIAL_FORM_STATE);

  const fetchRecipes = useCallback(async () => {
    const sequence = ++requestId.current;
    try {
      setLoading(true); setLoadError('');
      const { data } = await api.get('/admin/recipes', {
        params: {
          source: sourceFilter === 'all' ? undefined : sourceFilter,
          reviewStatus: reviewStatus === 'all' ? undefined : reviewStatus,
          qualityStatus: qualityStatus === 'all' ? undefined : qualityStatus,
          category: activeCategory === '全部' ? undefined : activeCategory,
          search: searchQuery.trim() || undefined,
          page,
          pageSize,
        },
      });
      if (sequence !== requestId.current) return;
      const pageData = asAdminPage<Recipe>(data, ['items', 'recipes']);
      setRecipes(pageData.items.map((item) => ({
        ...item,
        image_url: item.image_url || (item as Recipe & { cover_image_url?: string }).cover_image_url || '',
      })));
      setTotalRecipes(pageData.total);
      setSummary({
        platform: Number(pageData.summary?.platform || 0),
        user: Number(pageData.summary?.user || 0),
        pending: Number(pageData.summary?.pending || 0),
        needsReview: Number(pageData.summary?.needs_review || 0),
      });
    } catch {
      if (sequence === requestId.current) setLoadError('读取食谱失败，请重试。');
    } finally {
      if (sequence === requestId.current) setLoading(false);
    }
  }, [activeCategory, page, qualityStatus, reviewStatus, searchQuery, sourceFilter]);

  // Async mutations must refresh the committed query, not their starting filter.
  const currentRefresh = useRef<typeof fetchRecipes | null>(null);
  useLayoutEffect(() => {
    currentRefresh.current = fetchRecipes;
    return () => { currentRefresh.current = null; };
  }, [fetchRecipes]);
  const refreshCurrentRecipes = () => currentRefresh.current?.();

  useEffect(() => {
    const requestCounter = requestId;
    void fetchRecipes();
    return () => { requestCounter.current++; };
  }, [fetchRecipes]);

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要将这个食谱移入回收站吗？之后可在“安全审计”中恢复。')) return;
    try {
      await api.delete(`/admin/recipes/${id}`);
      refreshCurrentRecipes();
    } catch {
      if (currentRefresh.current) alert('删除失败');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/admin/recipes/${id}/approve`);
      await refreshCurrentRecipes();
    } catch (error: any) {
      if (currentRefresh.current) alert(error.response?.data?.error || '审核失败');
    }
  };

  const handleReject = async (id: number) => {
    const reason = window.prompt('请输入驳回原因，用户修改后可重新提交：');
    if (!reason) return;
    try {
      await api.post(`/admin/recipes/${id}/reject`, { reason });
      await refreshCurrentRecipes();
    } catch (error: any) {
      if (currentRefresh.current) alert(error.response?.data?.error || '驳回失败');
    }
  };

  const handleQualityReview = async (recipe: Recipe, status: 'trusted' | 'needs_review') => {
    const reason = window.prompt(
      status === 'trusted'
        ? '请输入设为可信的依据（例如：已逐项核对原始来源与营养数据）：'
        : '请输入待复核原因（该菜谱会立即退出公开列表和推荐）：',
      recipe.quality_review_reason || '',
    );
    if (!reason) return;
    try {
      await api.put(`/admin/recipes/${recipe.id}/quality`, { status, reason });
      await refreshCurrentRecipes();
    } catch (error: any) {
      if (currentRefresh.current) alert(error.response?.data?.error || '质量审核失败');
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData(INITIAL_FORM_STATE);
    setShowModal(true);
  };

  const handleOpenEdit = (recipe: Recipe) => {
    setEditingId(recipe.id);
    const parsedSteps = recipeDetailArray<string>(recipe.steps_json);
    const parsedIngredients = recipeDetailArray<Ingredient>(recipe.ingredients_json);

    setFormData({
      title: recipe.title || '',
      category: recipe.category || '减脂餐',
      calories: recipe.calories == null ? '' : String(recipe.calories),
      protein: recipe.protein == null ? '' : String(recipe.protein),
      carbs: recipe.carbs == null ? '' : String(recipe.carbs),
      fat: recipe.fat == null ? '' : String(recipe.fat),
      cook_time: recipe.cook_time ? String(recipe.cook_time).replace(/\s*分钟$/, '') : '',
      prep_time: recipe.prep_time == null ? '' : String(recipe.prep_time),
      difficulty: recipe.difficulty || '简单',
      image_url: recipe.image_url || '',
      description: recipe.description || '',
      steps: parsedSteps.length ? parsedSteps : INITIAL_FORM_STATE.steps,
      ingredients: parsedIngredients.length ? parsedIngredients : INITIAL_FORM_STATE.ingredients,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      alert('请输入食谱名称');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        title: formData.title.trim(),
        category: formData.category,
        ...recipeNutritionPayload(formData, editingId !== null),
        cook_time: formData.cook_time,
        prep_time: formData.prep_time,
        difficulty: formData.difficulty,
        image_url: formData.image_url.trim(),
        description: formData.description.trim(),
        steps_json: JSON.stringify(formData.steps.filter((s) => s.trim())),
        ingredients_json: JSON.stringify(
          formData.ingredients.filter((i) => i.name.trim() || i.amount.trim())
        ),
      };

      if (editingId) {
        await api.put(`/admin/recipes/${editingId}`, payload);
      } else {
        await api.post('/admin/recipes', payload);
      }

      if (!currentRefresh.current) return;
      setShowModal(false);
      refreshCurrentRecipes();
    } catch (err: any) {
      if (currentRefresh.current) alert('保存失败: ' + (err.response?.data?.error || err.message));
    } finally {
      if (currentRefresh.current) setSubmitting(false);
    }
  };

  const updateStep = (index: number, val: string) => {
    const newSteps = [...formData.steps];
    newSteps[index] = val;
    setFormData({ ...formData, steps: newSteps });
  };
  const addStep = () => setFormData({ ...formData, steps: [...formData.steps, ''] });
  const removeStep = (index: number) => {
    setFormData({ ...formData, steps: formData.steps.filter((_, i) => i !== index) });
  };

  const updateIngredient = (index: number, field: keyof Ingredient, val: string) => {
    const newIngs = [...formData.ingredients];
    newIngs[index] = { ...newIngs[index], [field]: val };
    setFormData({ ...formData, ingredients: newIngs });
  };
  const addIngredient = () =>
    setFormData({ ...formData, ingredients: [...formData.ingredients, { name: '', amount: '' }] });
  const removeIngredient = (index: number) => {
    setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== index) });
  };

  const recipeStats = useMemo(() => {
    return { total: totalRecipes, platform: summary.platform, userContributed: summary.user, pending: summary.pending, needsReview: summary.needsReview };
  }, [summary, totalRecipes]);



  return (
    <div className="admin-stack">
      <PageHeader title="食谱库" description="维护平台食谱，审核用户投稿，并核对营养质量。" actions={<AdminButton type="button" onClick={handleOpenAdd} variant="primary"><Plus size={16}/>发布官方食谱</AdminButton>}/>
      <div className="admin-summary-row"><span>当前筛选<strong>{loadError ? '—' : recipeStats.total}</strong></span><span>平台食谱<strong>{loadError ? '—' : recipeStats.platform}</strong></span><span>用户投稿<strong>{loadError ? '—' : recipeStats.userContributed}</strong></span><span>待发布审核<strong>{loadError ? '—' : recipeStats.pending}</strong></span></div>
      <FilterBar>
        <AdminField label="搜索" className="min-w-[200px] flex-1">
          <AdminInput aria-label="搜索食谱" placeholder="名称或关键词" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }} />
        </AdminField>
        <AdminField label="来源">
          <AdminSelect value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value as typeof sourceFilter); setPage(1); }}>
            <option value="all">全部来源</option><option value="official">平台食谱</option><option value="user">用户投稿</option>
          </AdminSelect>
        </AdminField>
        <AdminField label="分类">
          <AdminSelect value={activeCategory} onChange={(e) => { setActiveCategory(e.target.value); setPage(1); }}>
            {CATEGORIES.map((value) => <option key={value}>{value}</option>)}
          </AdminSelect>
        </AdminField>
        <AdminField label="发布审核">
          <AdminSelect value={reviewStatus} onChange={(e) => { setReviewStatus(e.target.value as typeof reviewStatus); setPage(1); }}>
            <option value="all">全部状态</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option>
          </AdminSelect>
        </AdminField>
        <AdminField label="营养质量">
          <AdminSelect value={qualityStatus} onChange={(e) => { setQualityStatus(e.target.value as typeof qualityStatus); setPage(1); }}>
            <option value="all">全部质量</option><option value="trusted">可信</option><option value="estimated">营养估算</option><option value="needs_review">待复核</option>
          </AdminSelect>
        </AdminField>
        <AdminButton type="button"  disabled={loading} onClick={() => void fetchRecipes()}>刷新</AdminButton>
      </FilterBar>
      {loadError && <p role="alert" className="admin-error">{loadError}</p>}
      {loading && <p role="status" className="admin-muted">正在加载…</p>}
      {recipes.length === 0 && !loading && !loadError ? (
        <EmptyState>未搜索到相关食谱</EmptyState>
      ) : recipes.length > 0 ? (
        <TableContainer>
            <table className="admin-table min-w-[860px] table-fixed">
              <colgroup>
                <col className="w-[29%]" />
                <col className="w-[15%]" />
                <col className="w-[14%]" />
                <col className="w-[20%]" />
                <col className="w-[22%]" />
              </colgroup>
              <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                <tr><th className="px-5 py-4 font-medium">食谱 / 来源</th><th className="px-3 py-4 font-medium">分类 / 制作</th><th className="px-3 py-4 font-medium">营养</th><th className="px-3 py-4 font-medium">发布审核 / 营养质量</th><th className="px-5 py-4 text-right font-medium">操作</th></tr>
              </thead>
              <tbody className="divide-y divide-background-alt">
                {recipes.map((recipe) => <tr key={recipe.id} className="hover:bg-accent/60">
                  <td className="px-5 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {recipe.image_url ? <img src={recipe.image_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <span className="h-12 w-12 shrink-0 rounded bg-gray-100 flex items-center justify-center text-gray-400"><UtensilsCrossed size={20}/></span>}
                      <div className="min-w-0 flex-1">
                        <button type="button" className="truncate text-sm font-semibold text-primary text-left max-w-full" title={recipe.title} onClick={()=>setSelectedRecipe(recipe)}>{recipe.title}</button>
                        <div className="mt-1 truncate text-xs text-text-muted" title={recipe.description || ''}>{recipe.description || '暂无简介'}</div>
                        <div className="mt-2 flex min-w-0 items-center gap-2">
                          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', recipe.source === 'user' ? 'bg-blue-50 text-blue-600' : 'bg-background-alt text-text-muted')}>{recipe.source === 'user' ? '用户投稿' : recipe.source === 'official' ? '官方自建' : '平台导入'}</span>
                          <span className="min-w-0 truncate text-[10px] text-text-muted" title={recipe.source === 'user' ? recipe.author_username || '未知用户' : recipe.source === 'official' ? '拾味编辑部' : recipe.source || '平台资料库'}>{recipe.source === 'user' ? recipe.author_username || '未知用户' : recipe.source === 'official' ? '拾味编辑部' : recipe.source || '平台资料库'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <p className="truncate text-sm font-medium text-text-main">{recipe.category || '综合推荐'}</p>
                    <p className="mt-1 text-xs text-text-muted">{recipe.difficulty || '简单'} · {typeof recipe.cook_time === 'number' ? `${recipe.cook_time} 分钟` : recipe.cook_time || '-'}</p>
                    <p className="mt-1 text-xs font-medium text-orange-700">{recipe.calories ?? 0} kcal</p>
                  </td>
                  <td className="px-3 py-3 text-xs text-text-muted">
                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                      <span>蛋白质</span><span className="font-medium text-text-main">{recipe.protein ?? 0}g</span>
                      <span>碳水</span><span className="font-medium text-text-main">{recipe.carbs ?? 0}g</span>
                      <span>脂肪</span><span className="font-medium text-text-main">{recipe.fat ?? 0}g</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className={cn('inline-flex rounded-full px-2 py-1 text-[10px] font-medium', recipe.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{recipeStatusText(recipe.status)}</span>
                      <span className={cn('inline-flex rounded-full px-2 py-1 text-[10px] font-medium', recipe.quality_status === 'needs_review' ? 'bg-red-50 text-red-700' : recipe.quality_status === 'estimated' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>{recipe.quality_status === 'needs_review' ? '待复核' : recipe.quality_status === 'estimated' ? '营养估算' : '可信'}</span>
                    </div>
                    {qualityIssueText(recipe) ? <div className="mt-1.5 truncate text-[10px] text-red-600" title={qualityIssueText(recipe)}>问题：{qualityIssueText(recipe)}</div> : null}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {recipe.source === 'user' && recipe.status === 'pending' && <><AdminButton onClick={() => handleApprove(recipe.id)} variant="primary">通过</AdminButton><AdminButton onClick={() => handleReject(recipe.id)} variant="danger">驳回</AdminButton></>}
                      <AdminButton onClick={() => handleQualityReview(recipe, recipe.quality_status === 'needs_review' ? 'trusted' : 'needs_review')}>{recipe.quality_status === 'needs_review' ? '设为可信' : '待复核'}</AdminButton>
                      <button onClick={() => handleOpenEdit(recipe)} className="rounded-lg p-2 text-text-muted hover:bg-primary/10 hover:text-primary" title="编辑" aria-label={`编辑 ${recipe.title}`}><Pencil size={15} /></button>
                      <button onClick={() => handleDelete(recipe.id)} className="rounded-lg p-2 text-text-muted hover:bg-red-50 hover:text-red-500" title="删除" aria-label={`删除 ${recipe.title}`}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
        </TableContainer>
      ) : null}
      {recipes.length > 0 ? (
        <AdminPagination page={page} pageSize={pageSize} total={totalRecipes} disabled={loading} onChange={setPage} />
      ) : null}

      {/* Add/Edit Recipe Modal */}
      {selectedRecipe && <DetailPanel title={selectedRecipe.title} onClose={()=>setSelectedRecipe(null)}>
        <div className="admin-stack">
          {selectedRecipe.image_url ? (
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
              <img src={selectedRecipe.image_url} alt={selectedRecipe.title} className="max-h-72 w-full object-contain" />
              <p className="truncate border-t border-gray-100 px-3 py-2 font-mono text-[11px] text-text-muted" title={selectedRecipe.image_url}>
                {selectedRecipe.image_url}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-text-muted">暂无封面图</div>
          )}
          <p>{selectedRecipe.description || '暂无简介'}</p>
          <div><h3 className="font-semibold mb-2">发布审核</h3><StatusBadge tone={selectedRecipe.status==='pending'?'warning':'neutral'}>{recipeStatusText(selectedRecipe.status)}</StatusBadge>{selectedRecipe.reject_reason && <p className="mt-2">驳回原因：{selectedRecipe.reject_reason}</p>}</div>
          <div><h3 className="font-semibold mb-2">营养质量</h3><StatusBadge tone={selectedRecipe.quality_status==='needs_review'?'warning':'neutral'}>{selectedRecipe.quality_status==='trusted'?'可信':selectedRecipe.quality_status==='estimated'?'营养估算':'待复核'}</StatusBadge><p className="mt-2">{selectedRecipe.quality_review_reason || '暂无质量审核说明'}</p><p className="admin-muted mt-2">热量 {selectedRecipe.calories} kcal · 蛋白质 {selectedRecipe.protein ?? '—'} g · 碳水 {selectedRecipe.carbs ?? '—'} g · 脂肪 {selectedRecipe.fat ?? '—'} g</p></div>
          <section><h3 className="font-semibold mb-2">原料</h3><ul className="space-y-2">{(recipeDetailArray(selectedRecipe.ingredients_json) as Ingredient[]).map((item,index)=><li key={index}>{item.name} · {item.amount}</li>)}</ul></section>
          <section><h3 className="font-semibold mb-2">做法</h3><ol className="list-decimal pl-5 space-y-3">{(recipeDetailArray(selectedRecipe.steps_json) as string[]).map((item,index)=><li key={index}>{item}</li>)}</ol></section>
          <RecipeProvenancePanel recipe={selectedRecipe} />
          <RecipeExecutionEditor key={selectedRecipe.id} recipeId={selectedRecipe.id} />
          <AdminButton  onClick={()=>{handleOpenEdit(selectedRecipe);setSelectedRecipe(null);}}>编辑食谱</AdminButton>
        </div>
      </DetailPanel>}
      {showModal && (
        <DialogFrame onClose={()=>setShowModal(false)} busy={submitting} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-3xl shadow-xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
              <h3 className="text-lg font-bold text-text-main">
                {editingId ? '编辑食谱' : '发布新食谱'}
              </h3>
              <button aria-label="关闭"
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-text-main p-1"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 基本信息 */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                  <UtensilsCrossed size={16} /> 基本信息
                </h4>
                <AdminField label="食谱标题 *">
                  <AdminInput
                    type="text"
                    required
                    placeholder="例如：低脂蒜香香煎鸡胸肉"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  />
                </AdminField>
                
                <div className="grid grid-cols-2 gap-3">
                  <AdminField label="食谱分类">
                    <AdminSelect
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    >
                      {CATEGORIES.filter((c) => c !== '全部').map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </AdminSelect>
                  </AdminField>
                  <AdminField label="烹饪难度">
                    <AdminSelect
                      value={formData.difficulty}
                      onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                    >
                      {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                    </AdminSelect>
                  </AdminField>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <AdminField label="烹饪时间（分钟）">
                    <AdminInput
                      type="number"
                      min="0"
                      step="1"
                      placeholder="未核实可留空"
                      value={formData.cook_time}
                      onChange={(e) => setFormData({ ...formData, cook_time: e.target.value })}
                    />
                  </AdminField>
                  <AdminField label="准备时间（分钟）">
                    <AdminInput
                      type="number"
                      min="0"
                      step="1"
                      placeholder="未核实可留空"
                      value={formData.prep_time}
                      onChange={(e) => setFormData({ ...formData, prep_time: e.target.value })}
                    />
                  </AdminField>
                  <AdminField label="封面图片 URL" className="col-span-2 sm:col-span-1">
                    <AdminInput
                      type="url"
                      placeholder="https://images.unsplash.com/..."
                      value={formData.image_url}
                      onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                      className="font-mono text-xs"
                    />
                    {formData.image_url.trim() ? (
                      <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                        <img
                          src={formData.image_url.trim()}
                          alt="封面预览"
                          className="max-h-48 w-full object-contain"
                          onError={(event) => {
                            (event.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    ) : null}
                  </AdminField>
                </div>

                <AdminField label="食谱简介">
                  <AdminTextarea
                    rows={2}
                    placeholder="简单描述此食谱的亮点..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </AdminField>
              </div>

              {/* 营养信息 */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <h4 className="text-sm font-bold text-secondary">营养信息 (每份)</h4>
                <div className="grid grid-cols-4 gap-3">
                  <AdminField label="热量 (kcal)">
                    <AdminInput
                      type="number"
                      placeholder="350"
                      value={formData.calories}
                      onChange={(e) => setFormData({ ...formData, calories: e.target.value })}
                    />
                  </AdminField>
                  <AdminField label="碳水 (g)">
                    <AdminInput
                      type="number"
                      step="0.1"
                      placeholder="10"
                      value={formData.carbs}
                      onChange={(e) => setFormData({ ...formData, carbs: e.target.value })}
                    />
                  </AdminField>
                  <AdminField label="蛋白质 (g)">
                    <AdminInput
                      type="number"
                      step="0.1"
                      placeholder="40"
                      value={formData.protein}
                      onChange={(e) => setFormData({ ...formData, protein: e.target.value })}
                    />
                  </AdminField>
                  <AdminField label="脂肪 (g)">
                    <AdminInput
                      type="number"
                      step="0.1"
                      placeholder="8"
                      value={formData.fat}
                      onChange={(e) => setFormData({ ...formData, fat: e.target.value })}
                    />
                  </AdminField>
                </div>
              </div>

              {/* 食材清单 */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-text-main">食材清单</h4>
                  <button
                    type="button"
                    onClick={addIngredient}
                    className="text-primary text-xs font-medium flex items-center gap-1 hover:underline"
                  >
                    <Plus size={14} /> 添加食材
                  </button>
                </div>
                <div className="space-y-2">
                  {formData.ingredients.map((ing, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <AdminInput
                        type="text"
                        className="flex-1 min-w-0"
                        placeholder="食材名称 (如: 鸡胸肉)"
                        value={ing.name}
                        onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                      />
                      <AdminInput
                        type="text"
                        className="flex-1 min-w-0"
                        placeholder="用量 (如: 200g)"
                        value={ing.amount}
                        onChange={(e) => updateIngredient(idx, 'amount', e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => removeIngredient(idx)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                        disabled={formData.ingredients.length === 1}
                      >
                        <Minus size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 烹饪步骤 */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-text-main">烹饪步骤</h4>
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-primary text-xs font-medium flex items-center gap-1 hover:underline"
                  >
                    <Plus size={14} /> 添加步骤
                  </button>
                </div>
                <div className="space-y-3">
                  {formData.steps.map((step, idx) => (
                    <div key={idx} className="flex gap-3 items-start">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-1">
                        {idx + 1}
                      </div>
                      <AdminTextarea
                        className="flex-1 min-w-0"
                        rows={2}
                        placeholder="描述该步骤的具体操作..."
                        value={step}
                        onChange={(e) => updateStep(idx, e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => removeStep(idx)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors mt-1"
                        disabled={formData.steps.length === 1}
                      >
                        <Minus size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="admin-actions justify-end pt-6 border-t border-gray-100">
                <AdminButton type="button" onClick={() => setShowModal(false)}>
                  取消
                </AdminButton>
                <AdminButton type="submit" variant="primary" disabled={submitting}>
                  {submitting ? '保存中...' : (editingId ? '保存修改' : '确认发布')}
                </AdminButton>
              </div>
            </form>
          </div>
        </DialogFrame>
      )}
    </div>
  );
}
