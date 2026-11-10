import { PageHeader } from '../components/admin/PageHeader';
import { RecipeProvenancePanel, type RecipeProvenance } from './RecipeProvenancePanel';
import { RecipeExecutionEditor } from './RecipeExecutionEditor';
import { FilterBar } from '../components/admin/ListPrimitives';
import { DetailPanel } from '../components/admin/DetailPanel';
import { StatusBadge } from '../components/admin/StatusBadge';
import { DialogFrame } from '../components/admin/DialogFrame';
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalRecipes, setTotalRecipes] = useState(0);
  const [summary, setSummary] = useState({ platform: 0, user: 0, pending: 0, needsReview: 0 });

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<RecipeFormState>(INITIAL_FORM_STATE);

  const fetchRecipes = useCallback(async (cursor?: string) => {
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
          pageSize: 50,
          cursor,
        },
      });
      if (sequence !== requestId.current) return;
      setRecipes(current => cursor ? [...current, ...data.items.filter((item: Recipe) => !current.some(existing => existing.id === item.id))] : data.items);
      setNextCursor(data.nextCursor);
      setTotalRecipes(Number(data.total || data.items.length));
      setSummary({
        platform: Number(data.summary?.platform || 0),
        user: Number(data.summary?.user || 0),
        pending: Number(data.summary?.pending || 0),
        needsReview: Number(data.summary?.needs_review || 0),
      });
    } catch {
      if (sequence === requestId.current) setLoadError('读取食谱失败，请重试。');
    } finally {
      if (sequence === requestId.current) setLoading(false);
    }
  }, [activeCategory, qualityStatus, reviewStatus, searchQuery, sourceFilter]);

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
    <div className="space-y-6">
      <PageHeader title="食谱库" description="维护平台食谱，审核用户投稿，并核对营养质量。" actions={<button type="button" onClick={handleOpenAdd} className="admin-button admin-button-primary"><Plus size={16}/>发布官方食谱</button>}/>
      <div className="admin-summary-row"><span>当前筛选<strong>{loadError ? '—' : recipeStats.total}</strong></span><span>平台食谱<strong>{loadError ? '—' : recipeStats.platform}</strong></span><span>用户投稿<strong>{loadError ? '—' : recipeStats.userContributed}</strong></span><span>待发布审核<strong>{loadError ? '—' : recipeStats.pending}</strong></span></div>
      <FilterBar>
        <label className="flex-1 min-w-48">搜索<input aria-label="搜索食谱" placeholder="名称或关键词" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} className="ml-2 border px-3"/></label>
        <label>来源 <select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value as typeof sourceFilter)} className="border px-3"><option value="all">全部来源</option><option value="official">平台食谱</option><option value="user">用户投稿</option></select></label>
        <label>分类 <select value={activeCategory} onChange={e=>setActiveCategory(e.target.value)} className="border px-3">{CATEGORIES.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>发布审核 <select value={reviewStatus} onChange={e=>setReviewStatus(e.target.value as typeof reviewStatus)} className="border px-3"><option value="all">全部状态</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option></select></label>
        <label>营养质量 <select value={qualityStatus} onChange={e=>setQualityStatus(e.target.value as typeof qualityStatus)} className="border px-3"><option value="all">全部质量</option><option value="trusted">可信</option><option value="estimated">营养估算</option><option value="needs_review">待复核</option></select></label>
        <button className="admin-button" disabled={loading} onClick={()=>void fetchRecipes()}>刷新</button>
      </FilterBar>
      {loadError && <p role="alert" className="admin-error">{loadError}</p>}
      {loading && <p role="status" className="admin-muted">正在加载…</p>}
      {recipes.length === 0 && !loading && !loadError ? (
        <div className="bg-white rounded-[24px] p-12 text-center text-text-muted border border-gray-100">
          未搜索到相关食谱
        </div>
      ) : (
        <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-fixed text-left">
              <colgroup>
                <col className="w-[29%]" />
                <col className="w-[15%]" />
                <col className="w-[14%]" />
                <col className="w-[20%]" />
                <col className="w-[22%]" />
              </colgroup>
              <thead className="border-b border-background-alt bg-[#FAFBFA] text-xs text-text-muted">
                <tr><th className="px-5 py-4 font-medium">食谱 / 来源</th><th className="px-3 py-4 font-medium">分类 / 制作</th><th className="px-3 py-4 font-medium">营养</th><th className="px-3 py-4 font-medium">发布审核 / 营养质量</th><th className="px-5 py-4 text-right font-medium">操作</th></tr>
              </thead>
              <tbody className="divide-y divide-background-alt">
                {recipes.map((recipe) => <tr key={recipe.id} className="hover:bg-[#FCFDFB]">
                  <td className="px-5 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {recipe.image_url ? <img src={recipe.image_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <span className="h-12 w-12 shrink-0 rounded bg-gray-100 flex items-center justify-center text-gray-400"><UtensilsCrossed size={20}/></span>}
                      <div className="min-w-0 flex-1">
                        <button type="button" className="truncate text-sm font-semibold text-primary text-left max-w-full" title={recipe.title} onClick={()=>setSelectedRecipe(recipe)}>{recipe.title}</button>
                        <div className="mt-1 truncate text-xs text-text-muted" title={recipe.description || ''}>{recipe.description || '暂无简介'}</div>
                        <div className="mt-2 flex min-w-0 items-center gap-2">
                          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', recipe.source === 'user' ? 'bg-blue-50 text-blue-600' : 'bg-background-alt text-text-muted')}>{recipe.source === 'user' ? '用户投稿' : recipe.source === 'official' ? '官方自建' : '平台导入'}</span>
                          <span className="min-w-0 truncate text-[10px] text-text-muted" title={recipe.source === 'user' ? recipe.author_username || '未知用户' : recipe.source === 'official' ? '食光编辑部' : recipe.source || '平台资料库'}>{recipe.source === 'user' ? recipe.author_username || '未知用户' : recipe.source === 'official' ? '食光编辑部' : recipe.source || '平台资料库'}</span>
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
                      {recipe.source === 'user' && recipe.status === 'pending' && <><button onClick={() => handleApprove(recipe.id)} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-white">通过</button><button onClick={() => handleReject(recipe.id)} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600">驳回</button></>}
                      <button onClick={() => handleQualityReview(recipe, recipe.quality_status === 'needs_review' ? 'trusted' : 'needs_review')} className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium', recipe.quality_status === 'needs_review' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{recipe.quality_status === 'needs_review' ? '设为可信' : '待复核'}</button>
                      <button onClick={() => handleOpenEdit(recipe)} className="rounded-lg p-2 text-text-muted hover:bg-primary/10 hover:text-primary" title="编辑" aria-label={`编辑 ${recipe.title}`}><Pencil size={15} /></button>
                      <button onClick={() => handleDelete(recipe.id)} className="rounded-lg p-2 text-text-muted hover:bg-red-50 hover:text-red-500" title="删除" aria-label={`删除 ${recipe.title}`}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {nextCursor ? <div className="border-t border-background-alt p-4 text-center"><button type="button" onClick={() => void fetchRecipes(nextCursor)} disabled={loading} className="rounded-xl border border-background-alt px-4 py-2 text-xs font-semibold text-primary disabled:opacity-50">加载更多食谱</button></div> : null}
        </div>
      )}

      {/* Add/Edit Recipe Modal */}
      {selectedRecipe && <DetailPanel title={selectedRecipe.title} onClose={()=>setSelectedRecipe(null)}>
        <div className="admin-stack">
          {selectedRecipe.image_url && <img src={selectedRecipe.image_url} alt={selectedRecipe.title} className="w-full max-h-64 object-contain"/>}
          <p>{selectedRecipe.description || '暂无简介'}</p>
          <div><h3 className="font-semibold mb-2">发布审核</h3><StatusBadge tone={selectedRecipe.status==='pending'?'warning':'neutral'}>{recipeStatusText(selectedRecipe.status)}</StatusBadge>{selectedRecipe.reject_reason && <p className="mt-2">驳回原因：{selectedRecipe.reject_reason}</p>}</div>
          <div><h3 className="font-semibold mb-2">营养质量</h3><StatusBadge tone={selectedRecipe.quality_status==='needs_review'?'warning':'neutral'}>{selectedRecipe.quality_status==='trusted'?'可信':selectedRecipe.quality_status==='estimated'?'营养估算':'待复核'}</StatusBadge><p className="mt-2">{selectedRecipe.quality_review_reason || '暂无质量审核说明'}</p><p className="admin-muted mt-2">热量 {selectedRecipe.calories} kcal · 蛋白质 {selectedRecipe.protein ?? '—'} g · 碳水 {selectedRecipe.carbs ?? '—'} g · 脂肪 {selectedRecipe.fat ?? '—'} g</p></div>
          <section><h3 className="font-semibold mb-2">原料</h3><ul className="space-y-2">{(recipeDetailArray(selectedRecipe.ingredients_json) as Ingredient[]).map((item,index)=><li key={index}>{item.name} · {item.amount}</li>)}</ul></section>
          <section><h3 className="font-semibold mb-2">做法</h3><ol className="list-decimal pl-5 space-y-3">{(recipeDetailArray(selectedRecipe.steps_json) as string[]).map((item,index)=><li key={index}>{item}</li>)}</ol></section>
          <RecipeProvenancePanel recipe={selectedRecipe} />
          <RecipeExecutionEditor key={selectedRecipe.id} recipeId={selectedRecipe.id} />
          <button className="admin-button" onClick={()=>{handleOpenEdit(selectedRecipe);setSelectedRecipe(null);}}>编辑食谱</button>
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
                <div>
                  <label className="block text-xs font-bold text-text-main mb-1">食谱标题 *</label>
                  <input
                    type="text"
                    required
                    placeholder="例如：低脂蒜香香煎鸡胸肉"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">食谱分类</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    >
                      {CATEGORIES.filter(c => c !== '全部').map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">烹饪难度</label>
                    <select
                      value={formData.difficulty}
                      onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    >
                      {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">烹饪时间（分钟）</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="未核实可留空"
                      value={formData.cook_time}
                      onChange={(e) => setFormData({ ...formData, cook_time: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">准备时间（分钟）</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="未核实可留空"
                      value={formData.prep_time}
                      onChange={(e) => setFormData({ ...formData, prep_time: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">封面图片 URL</label>
                    <input
                      type="url"
                      placeholder="https://images.unsplash.com/..."
                      value={formData.image_url}
                      onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-main mb-1">食谱简介</label>
                  <textarea
                    rows={2}
                    placeholder="简单描述此食谱的亮点..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
              </div>

              {/* 营养信息 */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <h4 className="text-sm font-bold text-secondary">营养信息 (每份)</h4>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">热量 (kcal)</label>
                    <input
                      type="number"
                      placeholder="350"
                      value={formData.calories}
                      onChange={(e) => setFormData({ ...formData, calories: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">碳水 (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="10"
                      value={formData.carbs}
                      onChange={(e) => setFormData({ ...formData, carbs: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">蛋白质 (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="40"
                      value={formData.protein}
                      onChange={(e) => setFormData({ ...formData, protein: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">脂肪 (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="8"
                      value={formData.fat}
                      onChange={(e) => setFormData({ ...formData, fat: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
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
                      <input
                        type="text"
                        placeholder="食材名称 (如: 鸡胸肉)"
                        value={ing.name}
                        onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                        className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                      />
                      <input
                        type="text"
                        placeholder="用量 (如: 200g)"
                        value={ing.amount}
                        onChange={(e) => updateIngredient(idx, 'amount', e.target.value)}
                        className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
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
                      <textarea
                        rows={2}
                        placeholder="描述该步骤的具体操作..."
                        value={step}
                        onChange={(e) => updateStep(idx, e.target.value)}
                        className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
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

              <div className="flex justify-end space-x-3 pt-6 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-text-muted hover:bg-gray-100 text-sm font-medium transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {submitting ? '保存中...' : (editingId ? '保存修改' : '确认发布')}
                </button>
              </div>
            </form>
          </div>
        </DialogFrame>
      )}
    </div>
  );
}
