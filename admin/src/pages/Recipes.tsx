import { AdminButton, AdminField, AdminInput, AdminPagination, AdminSelect, AdminTextarea, DetailPanel, DialogFrame, EmptyState, FilterBar, PageHeader, StatusBadge } from '@/components/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RecipeProvenancePanel, type RecipeProvenance } from './RecipeProvenancePanel';
import { RecipeExecutionEditor } from './RecipeExecutionEditor';
import { useQueryState } from '@/hooks/useQueryState';
import React, { useCallback, useEffect, useState, useMemo, useRef, useLayoutEffect } from 'react';
import {
  Minus,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import api from '@/services/api';
import { asAdminPage } from '@/utils/adminResponses';
import { formatMacro, parseRecipeArray, qualityIssueText, recipeStatusText, recipeNutritionPayload } from './recipeReviewModel';

type Recipe = RecipeProvenance & {
  id: number;
  title: string;
  category: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
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

  const loadRecipeDetail = async (id: number): Promise<Recipe | null> => {
    try {
      const { data } = await api.get(`/admin/recipes/${id}`);
      return {
        ...(data as Recipe),
        image_url: data.image_url || data.cover_image_url || '',
      };
    } catch {
      alert('读取食谱详情失败');
      return null;
    }
  };

  const openRecipeDetail = async (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    const detail = await loadRecipeDetail(recipe.id);
    if (detail) setSelectedRecipe(detail);
  };

  const handleOpenEdit = async (recipe: Recipe) => {
    const detail = (await loadRecipeDetail(recipe.id)) || recipe;
    setEditingId(detail.id);
    const parsedSteps = recipeDetailArray<string>(detail.steps_json);
    const parsedIngredients = recipeDetailArray<Ingredient>(detail.ingredients_json);

    setFormData({
      title: detail.title || '',
      category: detail.category || '减脂餐',
      calories: detail.calories == null ? '' : String(detail.calories),
      protein: detail.protein == null ? '' : String(detail.protein),
      carbs: detail.carbs == null ? '' : String(detail.carbs),
      fat: detail.fat == null ? '' : String(detail.fat),
      cook_time: detail.cook_time ? String(detail.cook_time).replace(/\s*分钟$/, '') : '',
      prep_time: detail.prep_time == null ? '' : String(detail.prep_time),
      difficulty: detail.difficulty || '简单',
      image_url: detail.image_url || '',
      description: detail.description || '',
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



  const qualityTone = (value?: Recipe['quality_status']) =>
    value === 'needs_review' ? 'danger' as const : value === 'estimated' ? 'warning' as const : 'success' as const;
  const reviewTone = (value?: Recipe['status']) =>
    value === 'approved' ? 'success' as const : value === 'rejected' ? 'danger' as const : 'warning' as const;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="食谱库" description="维护平台食谱，审核用户投稿，并核对营养质量。" actions={<AdminButton type="button" onClick={handleOpenAdd} variant="primary"><Plus size={16}/>发布官方食谱</AdminButton>}/>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '当前筛选', value: recipeStats.total },
          { label: '平台食谱', value: recipeStats.platform },
          { label: '用户投稿', value: recipeStats.userContributed },
          { label: '待发布审核', value: recipeStats.pending },
        ].map((stat) => (
          <Card key={stat.label} className="py-3">
            <CardContent className="flex flex-col gap-0.5">
              <p className="text-muted-foreground text-xs">{stat.label}</p>
              <p className="text-foreground text-xl font-semibold tracking-tight">{loadError ? '—' : stat.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>
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
      {loadError ? (
        <div role="alert" className="border-destructive/20 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {loadError}
        </div>
      ) : null}

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>食谱列表</CardTitle>
          <CardDescription>点击标题查看详情；用户投稿在待审核状态下可直接通过或驳回。</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && recipes.length === 0 ? <EmptyState>正在加载…</EmptyState> : null}
          {!loading && recipes.length === 0 && !loadError ? <EmptyState>未搜索到相关食谱</EmptyState> : null}
          {recipes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[220px]">食谱 / 来源</TableHead>
                  <TableHead>分类 / 制作</TableHead>
                  <TableHead>营养</TableHead>
                  <TableHead>发布审核 / 营养质量</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipes.map((recipe) => (
                  <TableRow key={recipe.id}>
                    <TableCell>
                      <div className="flex min-w-0 items-start gap-3">
                        {recipe.image_url ? (
                          <img src={recipe.image_url} alt="" className="ring-foreground/10 size-12 shrink-0 rounded-xl object-cover ring-1" />
                        ) : (
                          <span className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-xl">
                            <UtensilsCrossed size={20} />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            className="text-primary max-w-full truncate text-left text-sm font-semibold"
                            title={recipe.title}
                            onClick={() => { void openRecipeDetail(recipe); }}
                          >
                            {recipe.title}
                          </button>
                          <div className="text-muted-foreground mt-1 max-w-full truncate text-xs" title={recipe.description || ''}>
                            {recipe.description || '暂无简介'}
                          </div>
                          <div className="mt-2 flex min-w-0 items-center gap-2">
                            <Badge variant={recipe.source === 'user' ? 'default' : 'secondary'} className="shrink-0 text-[10px]">
                              {recipe.source === 'user' ? '用户投稿' : recipe.source === 'official' ? '官方自建' : '平台导入'}
                            </Badge>
                            <span
                              className="text-muted-foreground min-w-0 truncate text-[10px]"
                              title={
                                recipe.source === 'user'
                                  ? recipe.author_username || '未知用户'
                                  : recipe.source === 'official'
                                    ? '拾味编辑部'
                                    : recipe.source || '平台资料库'
                              }
                            >
                              {recipe.source === 'user'
                                ? recipe.author_username || '未知用户'
                                : recipe.source === 'official'
                                  ? '拾味编辑部'
                                  : recipe.source || '平台资料库'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-foreground truncate text-sm font-medium">{recipe.category || '综合推荐'}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {recipe.difficulty || '简单'} · {typeof recipe.cook_time === 'number' ? `${recipe.cook_time} 分钟` : recipe.cook_time || '-'}
                      </p>
                      <p className="text-primary mt-1 text-xs font-medium">{formatMacro(recipe.calories, 'kcal')}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-normal">
                      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                        <span>蛋白质</span>
                        <span className="text-foreground font-medium">{formatMacro(recipe.protein, 'g')}</span>
                        <span>碳水</span>
                        <span className="text-foreground font-medium">{formatMacro(recipe.carbs, 'g')}</span>
                        <span>脂肪</span>
                        <span className="text-foreground font-medium">{formatMacro(recipe.fat, 'g')}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadge tone={reviewTone(recipe.status)}>{recipeStatusText(recipe.status)}</StatusBadge>
                        <StatusBadge tone={qualityTone(recipe.quality_status)}>
                          {recipe.quality_status === 'needs_review' ? '待复核' : recipe.quality_status === 'estimated' ? '营养估算' : '可信'}
                        </StatusBadge>
                      </div>
                      {qualityIssueText(recipe) ? (
                        <div className="text-destructive mt-1.5 max-w-[200px] truncate text-[10px]" title={qualityIssueText(recipe)}>
                          问题：{qualityIssueText(recipe)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {recipe.source === 'user' && recipe.status === 'pending' ? (
                          <>
                            <AdminButton onClick={() => handleApprove(recipe.id)} variant="primary">
                              通过
                            </AdminButton>
                            <AdminButton onClick={() => handleReject(recipe.id)} variant="danger">
                              驳回
                            </AdminButton>
                          </>
                        ) : null}
                        <AdminButton
                          onClick={() => handleQualityReview(recipe, recipe.quality_status === 'needs_review' ? 'trusted' : 'needs_review')}
                        >
                          {recipe.quality_status === 'needs_review' ? '设为可信' : '待复核'}
                        </AdminButton>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleOpenEdit(recipe)} title="编辑" aria-label={`编辑 ${recipe.title}`}>
                          <Pencil size={15} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive"
                          onClick={() => handleDelete(recipe.id)}
                          title="删除"
                          aria-label={`删除 ${recipe.title}`}
                        >
                          <Trash2 size={15} />
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
      {recipes.length > 0 ? (
        <AdminPagination page={page} pageSize={pageSize} total={totalRecipes} disabled={loading} onChange={setPage} />
      ) : null}

      {/* Add/Edit Recipe Modal */}
      {selectedRecipe && <DetailPanel title={selectedRecipe.title} onClose={()=>setSelectedRecipe(null)}>
        <div className="flex flex-col gap-5">
          {selectedRecipe.image_url ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-muted">
              <img src={selectedRecipe.image_url} alt={selectedRecipe.title} className="max-h-72 w-full object-contain" />
              <p className="truncate border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground" title={selectedRecipe.image_url}>
                {selectedRecipe.image_url}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">暂无封面图</div>
          )}
          <p>{selectedRecipe.description || '暂无简介'}</p>
          <div><h3 className="font-semibold mb-2">发布审核</h3><StatusBadge tone={selectedRecipe.status==='pending'?'warning':'neutral'}>{recipeStatusText(selectedRecipe.status)}</StatusBadge>{selectedRecipe.reject_reason && <p className="mt-2">驳回原因：{selectedRecipe.reject_reason}</p>}</div>
          <div><h3 className="font-semibold mb-2">营养质量</h3><StatusBadge tone={selectedRecipe.quality_status==='needs_review'?'warning':'neutral'}>{selectedRecipe.quality_status==='trusted'?'可信':selectedRecipe.quality_status==='estimated'?'营养估算':'待复核'}</StatusBadge><p className="mt-2">{selectedRecipe.quality_review_reason || '暂无质量审核说明'}</p><p className="text-muted-foreground text-xs mt-2">热量 {formatMacro(selectedRecipe.calories, 'kcal')} · 蛋白质 {formatMacro(selectedRecipe.protein, 'g')} · 碳水 {formatMacro(selectedRecipe.carbs, 'g')} · 脂肪 {formatMacro(selectedRecipe.fat, 'g')}</p></div>
          <section><h3 className="font-semibold mb-2">原料</h3><ul className="space-y-2">{(recipeDetailArray(selectedRecipe.ingredients_json) as Ingredient[]).map((item,index)=><li key={index}>{item.name} · {item.amount}</li>)}</ul></section>
          <section><h3 className="font-semibold mb-2">做法</h3><ol className="list-decimal pl-5 space-y-3">{(recipeDetailArray(selectedRecipe.steps_json) as string[]).map((item,index)=><li key={index}>{item}</li>)}</ol></section>
          <RecipeProvenancePanel recipe={selectedRecipe} />
          <RecipeExecutionEditor key={selectedRecipe.id} recipeId={selectedRecipe.id} />
          <AdminButton  onClick={()=>{handleOpenEdit(selectedRecipe);setSelectedRecipe(null);}}>编辑食谱</AdminButton>
        </div>
      </DetailPanel>}
      {showModal && (
        <DialogFrame onClose={()=>setShowModal(false)} busy={submitting} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card text-card-foreground rounded-3xl p-6 w-full max-w-3xl shadow-xl ring-1 ring-foreground/10 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
              <h3 className="text-lg font-bold text-foreground">
                {editingId ? '编辑食谱' : '发布新食谱'}
              </h3>
              <button aria-label="关闭"
                onClick={() => setShowModal(false)}
                className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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
                      placeholder="https://cdn.lingecho.com/dietdigidose/catalog/recipes/1-332bf9a8368f7d52.jpg"
                      value={formData.image_url}
                      onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                      className="font-mono text-xs"
                    />
                    {formData.image_url.trim() ? (
                      <div className="mt-2 overflow-hidden rounded-xl border border-border bg-muted">
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
              <div className="space-y-4 pt-4 border-t border-border">
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
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-foreground">食材清单</h4>
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
                        className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                        disabled={formData.ingredients.length === 1}
                      >
                        <Minus size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 烹饪步骤 */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-foreground">烹饪步骤</h4>
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
                        className="p-2 text-muted-foreground hover:text-destructive transition-colors mt-1"
                        disabled={formData.steps.length === 1}
                      >
                        <Minus size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-6 border-t border-border">
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
