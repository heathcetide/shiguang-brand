import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { RecipeExecutionProfile, RecipeSubstitution, RecipeTaskGraph } from '@dietdigidose/contracts/recipe-execution';
import api from '../services/api';

type Variant = Omit<RecipeSubstitution, 'recipeId'> & { recipeId: string; preview?: { title: string; servingSize: number; ingredients: Array<{ name: string; amount: string }>; steps: string[] } };
type Task = Omit<RecipeExecutionProfile['tasks'][number], 'minutes'> & { minutes: string };
type Tool = { key: string; catalogId: string; capacityKind: 'not_applicable' | 'volume'; mlPerServing: string };
type Catalog = { id: number; name: string; quality_status?: string };
type HandlingForm = { storage: '' | 'fresh_only' | 'refrigerated'; hours: string; cold: '' | 'yes' | 'no'; carry: '' | 'yes' | 'no'; sourceUrl: string; reference: string; instructions: string };
const emptyHandling: HandlingForm = { storage: '', hours: '', cold: '', carry: '', sourceUrl: '', reference: '', instructions: '' };
const phases = { preparation: '准备', cooking: '烹饪', cleanup: '收尾' };
type ReheatForm = { reference: string; servings: string; sourceUrl: string; instructions: string; tools: Tool[]; tasks: Task[] };
const graphForm = (graph: RecipeTaskGraph, sourceUrl = '', instructions = ''): ReheatForm => ({ reference: graph.reference, servings: String(graph.maxBatchServings), sourceUrl, instructions,
  tools: graph.tools.map(tool => ({ key: tool.key, catalogId: String(tool.catalogId), capacityKind: tool.capacity.kind, mlPerServing: tool.capacity.kind === 'volume' ? String(tool.capacity.mlPerServing) : '' })),
  tasks: graph.tasks.map(task => ({ ...task, minutes: String(task.minutes) })) });
const field = 'border rounded-lg px-2 py-1 w-full';

export function RecipeExecutionEditor({ recipeId }: { recipeId: number }) {
  const [recipeKey, setRecipeKey] = useState('');
  const [reviewKey, setReviewKey] = useState('');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [reference, setReference] = useState('');
  const [servings, setServings] = useState('');
  const [tools, setTools] = useState<Tool[]>([]);
  const [handling, setHandling] = useState<HandlingForm>(emptyHandling);
  const [reheating, setReheating] = useState<ReheatForm | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setMessage('');
    void Promise.all([api.get(`/admin/recipes/${recipeId}/execution`), api.get('/admin/kitchenware/catalog')]).then(([record, devices]) => {
      if (!active) return;
      setRecipeKey(record.data.recipeKey);
      setReviewKey(record.data.reviewKey);
      setCatalog(devices.data.filter((item: Catalog) => item.quality_status == null || item.quality_status === 'trusted'));
      const profile = record.data.execution?.profile as RecipeExecutionProfile | undefined;
      setVariants(profile?.substitutions?.map(rule => ({ ...rule, recipeId: String(rule.recipeId) })) ?? []);
      setReheating(profile?.reheating ? graphForm(profile.reheating, profile.reheating.sourceUrl, profile.reheating.instructions) : null);
      const rule = profile?.handling;
      setHandling(rule ? { storage: rule.storage, hours: String(rule.maxHoldHours), cold: rule.coldServingAllowed ? 'yes' : 'no', carry: rule.carryAllowed ? 'yes' : 'no', sourceUrl: rule.sourceUrl, reference: rule.reference, instructions: rule.instructions } : emptyHandling);
      setReference(profile?.reference ?? ''); setServings(profile ? String(profile.maxBatchServings) : '');
      setTools(profile?.tools.map(tool => ({ key: tool.key, catalogId: String(tool.catalogId), capacityKind: tool.capacity.kind,
        mlPerServing: tool.capacity.kind === 'volume' ? String(tool.capacity.mlPerServing) : '' })) ?? []);
      setTasks(profile?.tasks.map(task => ({ ...task, minutes: String(task.minutes) })) ?? [
        { id: 'prepare', title: '准备食材', phase: 'preparation', minutes: '', active: true, dependsOn: [], tools: [] },
        { id: 'cook', title: '烹饪', phase: 'cooking', minutes: '', active: true, dependsOn: ['prepare'], tools: [] },
        { id: 'clean', title: '收尾', phase: 'cleanup', minutes: '', active: true, dependsOn: ['cook'], tools: [] },
      ]);
      setMessage(profile ? '已加载当前食谱的审核流程。修改后需重新审核保存。' : '当前没有有效的制作流程审核，不能据此保证完整用时。');
    }).catch(() => { if (active) setMessage('读取制作流程失败，请关闭详情后重试。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [recipeId]);
  const readVariant = async (variant: Variant) => {
    if (!/^\d+$/.test(variant.recipeId) || Number(variant.recipeId) === recipeId) { setMessage('请填写另一道变体菜谱的有效编号'); return; }
    setBusy(true);
    try {
      const response = await api.get(`/admin/recipes/${variant.recipeId}/execution`);
      if (!response.data.execution) throw new Error('请先审核变体的制作流程');
      setVariants(current => current.map(item => item === variant ? { ...item, recipeKey: response.data.recipeKey, preview: response.data } : item));
      setMessage('已读取变体当前版本，请核对完整用量、份数、步骤与替代依据。');
    } catch (error: any) { setMessage(error.response?.data?.error || error.message || '读取变体失败'); }
    finally { setBusy(false); }
  };
  const save = async (remove = false) => {
    let profile: RecipeExecutionProfile | null = null;
    if (!remove) {
      if (variants.some(variant => !variant.recipeKey)) { setMessage('请先读取并核对每道替代变体的当前版本，再保存审核。'); return; }
      if (!servings.trim() || tasks.some(task => !task.minutes.trim()) || tools.some(tool => !tool.catalogId || (tool.capacityKind === 'volume' && !tool.mlPerServing.trim()))) {
        setMessage('请填写批次份量、每项时间上限与设备容量依据；没有依据时请保留未审核状态。'); return;
      }
      if (handling.storage && (!handling.cold || !handling.carry || (handling.storage === 'refrigerated' && !handling.hours.trim()))) {
        setMessage('请明确冷藏期限、冷食与携带适用性；没有审核依据时选择未审核。'); return;
      }
      if (reheating && (!reheating.servings.trim() || reheating.tasks.some(task => !task.minutes.trim()) || reheating.tools.some(tool => !tool.catalogId || (tool.capacityKind === 'volume' && !tool.mlPerServing.trim())))) {
        setMessage('请填写复热批次份量、每项时间与设备容量依据；没有依据时取消复热审核。'); return;
      }
      // The existing save endpoint validates the complete shared schema. Keep
      // immediate required-field checks here without shipping a duplicate validator.
      profile = { version: 1, reference, maxBatchServings: Number(servings),
        tools: tools.map(tool => ({ key: tool.key, name: catalog.find(item => String(item.id) === tool.catalogId)?.name ?? '', catalogId: Number(tool.catalogId),
          capacity: tool.capacityKind === 'volume' ? { kind: 'volume', mlPerServing: Number(tool.mlPerServing) } : { kind: 'not_applicable' } })),
        ...(handling.storage ? { handling: { storage: handling.storage, maxHoldHours: handling.storage === 'fresh_only' ? 0 : Number(handling.hours), coldServingAllowed: handling.cold === 'yes', carryAllowed: handling.carry === 'yes', sourceUrl: handling.sourceUrl, reference: handling.reference, instructions: handling.instructions } } : {}),
        ...(reheating ? { reheating: { version: 1, reference: reheating.reference, maxBatchServings: Number(reheating.servings), sourceUrl: reheating.sourceUrl, instructions: reheating.instructions,
          tools: reheating.tools.map(tool => ({ key: tool.key, name: catalog.find(item => String(item.id) === tool.catalogId)?.name ?? '', catalogId: Number(tool.catalogId), capacity: tool.capacityKind === 'volume' ? { kind: 'volume', mlPerServing: Number(tool.mlPerServing) } : { kind: 'not_applicable' } })),
          tasks: reheating.tasks.map(task => ({ ...task, minutes: Number(task.minutes) })) } } : {}),
        ...(variants.length ? { substitutions: variants.map(({ preview: _preview, ...rule }) => ({ ...rule, recipeId: Number(rule.recipeId) })) } : {}),
        tasks: tasks.map(task => ({ ...task, minutes: Number(task.minutes) })),
      };
    }
    setBusy(true);
    try {
      const response = await api.put(`/admin/recipes/${recipeId}/execution`, { recipeKey, reviewKey, profile });
      setReviewKey(response.data.reviewKey);
      setMessage(remove ? '制作流程审核已撤销，后续推荐将重新标为待核对。' : '制作流程审核已保存。食材、份数、步骤或厨具改变后会失效。');
    } catch (error: any) {
      const issues = error.response?.data?.details;
      const messages = Array.isArray(issues) ? issues.map(issue => typeof issue?.message === 'string' ? issue.message : '').filter(Boolean) : [];
      setMessage(messages.join('；') || error.response?.data?.error || '审核保存失败，请重试。');
    }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">制作流程审核</h3>
    <p className="text-sm text-text-muted">按可核对的来源或实测记录填写每批用时上限，包含准备、烹饪和收尾。小批次沿用此上限；专用设备保留到该批收尾完成。</p>
    <p role="status" className="text-sm">{loading ? '正在读取…' : message}</p>
    <fieldset disabled={busy || loading || !recipeKey} className="space-y-3">
      <label className="block">审核依据<textarea aria-label="制作流程审核依据" value={reference} onChange={event => setReference(event.target.value)} placeholder="来源、实测记录及核对条件" className={field} /></label>
      <label className="block">单批最多制作份量<input aria-label="单批最多制作份量" type="number" min="0.001" max="30" step="any" value={servings} onChange={event => setServings(event.target.value)} className={field} /></label>
      <GraphFields tools={tools} setTools={setTools} tasks={tasks} setTasks={setTasks} catalog={catalog} />
      <h4 className="font-medium">存放、携带与复热审核</h4>
      <p className="text-sm text-text-muted">填写适用于该菜谱的来源与条件。未审核时保留未知；日期核对覆盖食用日全天，实际冷链与复热仍需确认。</p>
      <label className="block">存放规则<select aria-label="存放规则" value={handling.storage} onChange={event => setHandling(current => ({ ...current, storage: event.target.value as HandlingForm['storage'] }))} className={field}><option value="">未审核</option><option value="fresh_only">仅限现做现吃</option><option value="refrigerated">符合条件时冷藏</option></select></label>
      {handling.storage ? <div className="space-y-2">
        {handling.storage === 'refrigerated' ? <label className="block">冷藏期限上限（小时）<input aria-label="冷藏期限上限" type="number" min="1" max="96" step="1" value={handling.hours} onChange={event => setHandling(current => ({ ...current, hours: event.target.value }))} className={field} /></label> : null}
        {([['cold', '是否可冷食'], ['carry', '是否支持携带']] as const).map(([key, label]) => <label key={key} className="block">{label}<select aria-label={label} value={handling[key]} onChange={event => setHandling(current => ({ ...current, [key]: event.target.value as HandlingForm['cold'] }))} className={field}><option value="">尚未确认</option><option value="yes">审核允许（须满足所列条件）</option><option value="no">审核不允许</option></select></label>)}
        <label className="block">来源链接<input aria-label="存放审核来源链接" type="url" value={handling.sourceUrl} onChange={event => setHandling(current => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://" className={field} /></label>
        <label className="block">核对依据<textarea aria-label="存放核对依据" value={handling.reference} onChange={event => setHandling(current => ({ ...current, reference: event.target.value }))} className={field} /></label>
        <label className="block">实际存放与食用条件<textarea aria-label="实际存放与食用条件" value={handling.instructions} onChange={event => setHandling(current => ({ ...current, instructions: event.target.value }))} className={field} /></label>
      </div> : null}
      <h4 className="font-medium">食用前复热流程</h4>
      <p className="text-sm text-text-muted">复热单独审核容量、取出准备、加热与检查、收尾及实际食用条件；不要照抄制作分钟数。流程审核不能证明实际食品温度或冷链。</p>
      <label><input aria-label="填写复热流程" type="checkbox" checked={Boolean(reheating)} onChange={event => setReheating(event.target.checked ? { reference: '', servings: '', sourceUrl: '', instructions: '', tools: [], tasks: [
        { id: 'prepare', title: '取出与准备', phase: 'preparation', minutes: '', active: true, dependsOn: [], tools: [] },
        { id: 'heat', title: '复热与检查', phase: 'cooking', minutes: '', active: true, dependsOn: ['prepare'], tools: [] },
        { id: 'clean', title: '收尾', phase: 'cleanup', minutes: '', active: true, dependsOn: ['heat'], tools: [] },
      ] } : null)} /> 有可核对的复热依据</label>
      {reheating ? <div className="space-y-3 border rounded-xl p-3">
        {([['reference', '复热审核依据'], ['sourceUrl', '复热来源链接'], ['instructions', '复热与实际检查条件'], ['servings', '复热单批最多份量']] as const).map(([key, label]) => <label key={key} className="block">{label}<input aria-label={label} value={reheating[key]} onChange={event => setReheating(current => current ? { ...current, [key]: event.target.value } : null)} className={field} /></label>)}
        <GraphFields tools={reheating.tools} tasks={reheating.tasks} catalog={catalog} prefix="复热"
          setTools={action => setReheating(current => current ? { ...current, tools: typeof action === 'function' ? action(current.tools) : action } : null)}
          setTasks={action => setReheating(current => current ? { ...current, tasks: typeof action === 'function' ? action(current.tasks) : action } : null)} />
      </div> : null}
      <h4 className="font-medium">原料替代的审核变体</h4>
      <p className="text-sm text-text-muted">变体先独立填写完整用量、步骤和制作审核。仅替换所列一种原料，份数与其他原料不变；菜谱修改或撤审后不继续提供替代依据。</p>
      {variants.map((variant, index) => <div key={index} className="border rounded-xl p-3 space-y-2">
        <label className="block">变体菜谱编号<input aria-label={`替代 ${index + 1} 菜谱编号`} type="number" min="1" step="1" value={variant.recipeId} onChange={event => setVariants(current => current.map((item, i) => i === index ? { ...item, recipeId: event.target.value, recipeKey: '', preview: undefined } : item))} className={field} /></label>
        <button type="button" className="admin-button" onClick={() => void readVariant(variant)}>读取并核对变体</button>
        {variant.preview ? <div className="text-sm"><p>{variant.preview.title} · {variant.preview.servingSize} 份</p><p>用量：{variant.preview.ingredients.map(item => `${item.name} ${item.amount}`).join('；')}</p><p>步骤：{variant.preview.steps.join('；')}</p></div> : null}
        {variant.recipeKey ? <p className="text-xs">已绑定变体版本 {variant.recipeKey.slice(0, 12)}</p> : null}
        {([['removedIngredient', '原原料名称'], ['replacementIngredient', '替代原料名称'], ['sourceUrl', '替代来源链接'], ['reference', '替代核对依据']] as const).map(([key, label]) => <label key={key} className="block">{label}<input aria-label={`替代 ${index + 1} ${label}`} value={variant[key]} onChange={event => setVariants(current => current.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} className={field} /></label>)}
        <button type="button" className="admin-button" onClick={() => setVariants(current => current.filter((_, i) => i !== index))}>移除此替代关系</button>
      </div>)}
      <button type="button" className="admin-button" disabled={variants.length >= 10} onClick={() => setVariants(current => [...current, { recipeId: '', recipeKey: '', removedIngredient: '', replacementIngredient: '', sourceUrl: '', reference: '' }])}>添加审核变体</button>
      <div className="flex gap-2"><button type="button" className="admin-button" onClick={() => void save()}>审核保存制作流程</button><button type="button" className="admin-button" onClick={() => void save(true)}>撤销制作流程审核</button></div>
    </fieldset>
  </section>;
}

function GraphFields({ tools, setTools, tasks, setTasks, catalog, prefix = '' }: { tools: Tool[]; setTools: Dispatch<SetStateAction<Tool[]>>; tasks: Task[]; setTasks: Dispatch<SetStateAction<Task[]>>; catalog: Catalog[]; prefix?: string }) {
  const update = (id: string, patch: Partial<Task>) => setTasks(current => current.map(task => task.id === id ? { ...task, ...patch } : task));
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
  return <div className="space-y-3">
      <h4 className="font-medium">设备与容量依据</h4>
      {tools.map(tool => <div key={tool.key} className="border rounded-xl p-3 space-y-2">
        <label>设备<select aria-label={`${prefix}制作设备`} value={tool.catalogId} onChange={event => setTools(current => current.map(item => item.key === tool.key ? { ...item, catalogId: event.target.value } : item))} className={field}><option value="">选择已审核目录</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>容量要求<select aria-label={`${prefix}容量要求`} value={tool.capacityKind} onChange={event => setTools(current => current.map(item => item.key === tool.key ? { ...item, capacityKind: event.target.value as Tool['capacityKind'] } : item))} className={field}><option value="volume">按每份容积核对</option><option value="not_applicable">该设备无需容积校验</option></select></label>
        {tool.capacityKind === 'volume' ? <label>每份需要的可用容积（毫升）<input aria-label={`${prefix}每份需要容积`} type="number" min="0" step="any" value={tool.mlPerServing} onChange={event => setTools(current => current.map(item => item.key === tool.key ? { ...item, mlPerServing: event.target.value } : item))} className={field} /></label> : null}
        <button type="button" className="admin-button" onClick={() => { setTools(current => current.filter(item => item.key !== tool.key)); setTasks(current => current.map(task => ({ ...task, tools: task.tools.filter(key => key !== tool.key) }))); }}>移除此设备</button>
      </div>)}
      <button type="button" className="admin-button" onClick={() => setTools(current => [...current, { key: crypto.randomUUID(), catalogId: '', capacityKind: 'volume', mlPerServing: '' }])}>添加设备</button>
      <h4 className="font-medium">任务顺序与占用</h4>
      {tasks.map((task, index) => <div key={task.id} className="border rounded-xl p-3 space-y-2">
        <label>任务 {index + 1}<input aria-label={`${prefix}任务 ${index + 1} 名称`} value={task.title} onChange={event => update(task.id, { title: event.target.value })} className={field} /></label>
        <label>阶段<select aria-label={`${prefix}任务 ${index + 1} 阶段`} value={task.phase} onChange={event => update(task.id, { phase: event.target.value as Task['phase'], active: event.target.value !== 'cooking' || task.active })} className={field}>{Object.entries(prefix ? { ...phases, cooking: '复热与检查' } : phases).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>用时上限（整分钟）<input aria-label={`${prefix}任务 ${index + 1} 用时上限`} type="number" min="0" max="1440" step="1" value={task.minutes} onChange={event => update(task.id, { minutes: event.target.value })} className={field} /></label>
        <label className="block"><input type="checkbox" checked={task.active} disabled={task.phase !== 'cooking'} onChange={event => update(task.id, { active: event.target.checked })} /> 持续需要人工操作（取消仅用于已核实可等待的烹饪任务）</label>
        <p>开始前必须完成：</p>{tasks.filter(other => other.id !== task.id).map(other => <label key={other.id} className="block text-sm"><input type="checkbox" checked={task.dependsOn.includes(other.id)} onChange={() => update(task.id, { dependsOn: toggle(task.dependsOn, other.id) })} /> {other.title}</label>)}
        <p>使用设备：</p>{tools.map(tool => <label key={tool.key} className="block text-sm"><input type="checkbox" checked={task.tools.includes(tool.key)} onChange={() => update(task.id, { tools: toggle(task.tools, tool.key) })} /> {catalog.find(item => String(item.id) === tool.catalogId)?.name ?? '尚未选择的设备'}</label>)}
        <button type="button" className="admin-button" onClick={() => setTasks(current => current.filter(item => item.id !== task.id).map(item => ({ ...item, dependsOn: item.dependsOn.filter(id => id !== task.id) })))}>移除此任务</button>
      </div>)}
      <button type="button" className="admin-button" onClick={() => setTasks(current => [...current, { id: crypto.randomUUID(), title: '', phase: 'preparation', minutes: '', active: true, dependsOn: [], tools: [] }])}>添加任务</button>
  </div>;
}
