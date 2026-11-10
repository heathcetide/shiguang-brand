import { DialogFrame } from '../components/admin/DialogFrame';
import type { KitchenwareCapabilityConstraints } from "@dietdigidose/contracts";
import { kitchenwareFunctionLabels } from "@dietdigidose/contracts/kitchenware-options";
import { useEffect, useState } from 'react';
import api from '../services/api';

type Capability = { code: string; name: string; safety_level: string };
type Draft = { code: string; capacity: string; diameter: string; heat: string; functions: NonNullable<KitchenwareCapabilityConstraints["requiredFunctions"]>; invalid?: string };
type Configuration = { token: string; available: Capability[]; capabilities: { code: string; constraints: unknown }[] };
const fieldClass = 'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2';
function draft(row: Configuration['capabilities'][number]): Draft {
  const raw = row.constraints as Record<string, unknown> | null;
  const valid = raw && typeof raw === 'object' && !Array.isArray(raw)
    && Object.keys(raw).every(key => ['minCapacityMl', 'minDiameterCm', 'heatSource', 'requiredFunctions'].includes(key))
    && (raw.minCapacityMl === undefined || typeof raw.minCapacityMl === 'number')
    && (raw.minDiameterCm === undefined || typeof raw.minDiameterCm === 'number')
    && (raw.heatSource === undefined || ['gas', 'induction', 'electric'].includes(String(raw.heatSource)))
    && (raw.requiredFunctions === undefined || (Array.isArray(raw.requiredFunctions) && raw.requiredFunctions.every(value => Object.hasOwn(kitchenwareFunctionLabels, value))));
  const condition = valid ? raw as KitchenwareCapabilityConstraints : {};

  return { code: row.code, functions: condition.requiredFunctions ?? [], capacity: valid && condition.minCapacityMl != null ? String(condition.minCapacityMl) : '',
    diameter: valid && condition.minDiameterCm != null ? String(condition.minDiameterCm) : '',
    heat: valid ? String(condition.heatSource ?? '') : '', invalid: valid ? undefined : JSON.stringify(row.constraints) };
}
export default function KitchenwareCapabilities({ item, onClose }: { item: { id: number; name: string }; onClose: () => void }) {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    api.get<Configuration>(`/admin/kitchenware/catalog/${item.id}/capabilities`).then(({ data }) => {
      if (active) { setConfiguration(data); setRows(data.capabilities.map(draft)); }
    }).catch(() => { if (active) setMessage('加载失败，请关闭后重试'); });
    return () => { active = false; };
  }, [item.id]);
  const change = (index: number, patch: Partial<Draft>) => { setConfirmed(false); setRows(current => current.map((row,i) => i === index ? { ...row, ...patch } : row)); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configuration || rows.some(row => row.invalid !== undefined)) return;
    if (!confirmed) { setConfirmed(true); return; }
    setSaving(true); setMessage('');
    try {
      await api.put(`/admin/kitchenware/catalog/${item.id}/capabilities`, { token: configuration.token,
        capabilities: rows.map(row => ({ code: row.code, constraints: {
          ...(row.capacity !== '' ? { minCapacityMl: Number(row.capacity) } : {}),
          ...(row.diameter !== '' ? { minDiameterCm: Number(row.diameter) } : {}),
          ...(row.functions.length ? { requiredFunctions: row.functions } : {}),
          ...(row.heat ? { heatSource: row.heat } : {}),
        } })) });
      onClose();
    } catch (error: any) { setMessage(error.response?.data?.error || '保存失败'); setConfirmed(false); }
    finally { setSaving(false); }
  };
  return <DialogFrame onClose={onClose} busy={saving} className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
    <form onSubmit={save} role="dialog" aria-modal="true" aria-label={`${item.name}的能力条件`} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
      <h2 className="text-lg font-semibold">{item.name} · 能力条件</h2>
      <p className="my-3 text-sm text-text-muted">仅登记核实过的能力。条件用于所有用户的推荐判断，须由同一件设备满足；留空表示该项没有额外限制。受限能力不会自动放行。</p>
      {message && <p role="alert" className="my-3 text-red-600">{message}</p>}
      {!configuration && !message && <p>加载中…</p>}
      <fieldset disabled={saving} className="space-y-3">
        {rows.map((row,index) => <div key={row.code} className="rounded-xl border border-gray-200 p-3">
          <div className="flex items-center justify-between"><strong>{configuration?.available.find(capability => capability.code === row.code)?.name ?? row.code}</strong><button type="button" onClick={() => { setRows(current => current.filter((_,i) => i !== index)); setConfirmed(false); }} className="text-sm text-red-600">移除能力</button></div>
          {row.invalid !== undefined ? <p className="mt-2 text-sm text-red-600">存在无法识别的旧条件：{row.invalid}。请核对后移除并重新登记，不能静默覆盖。</p> : <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">最低容量（毫升）<input type="number" min="0.001" max="1000000" step="any" value={row.capacity} onChange={event => change(index,{ capacity: event.target.value })} className={fieldClass} /></label>
            <label className="text-sm">最小直径（厘米）<input type="number" min="0.001" max="1000" step="any" value={row.diameter} onChange={event => change(index,{ diameter: event.target.value })} className={fieldClass} /></label>
            <fieldset className="sm:col-span-3"><legend className="text-sm">必须具备的电器功能（同一设备）</legend>{(Object.keys(kitchenwareFunctionLabels) as Array<keyof typeof kitchenwareFunctionLabels>).map(value => <label key={value} className="mr-4 text-sm"><input type="checkbox" checked={row.functions.includes(value)} onChange={event => change(index, { functions: event.target.checked ? [...row.functions,value] : row.functions.filter(item => item !== value) })} />{kitchenwareFunctionLabels[value]}</label>)}</fieldset>
            <label className="text-sm">所需热源<select value={row.heat} onChange={event => change(index,{ heat: event.target.value })} className={fieldClass}><option value="">无额外限制</option><option value="gas">燃气</option><option value="induction">电磁炉</option><option value="electric">电热</option></select></label>
          </div>}
        </div>)}
        {configuration && <label className="block text-sm">添加已核实能力<select value="" onChange={event => { if (event.target.value) { setRows(current => [...current,{ code: event.target.value,capacity: '',diameter: '',heat: '',functions: [] }]); setConfirmed(false); } }} className={fieldClass}><option value="">选择能力</option>{configuration.available.filter(capability => !rows.some(row => row.code === capability.code)).map(capability => <option key={capability.code} value={capability.code}>{capability.name}{capability.safety_level === 'restricted' ? '（受限）' : ''}</option>)}</select></label>}
      </fieldset>
      {confirmed && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">将保存当前 {rows.length} 项能力及条件，并影响使用此目录的推荐判断。确认所有修改后提交。</p>}
      <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={saving} onClick={onClose}>取消</button><button disabled={!configuration || saving || rows.some(row => row.invalid !== undefined)} className="rounded-xl bg-primary px-4 py-2 text-white disabled:opacity-50">{saving ? '保存中…' : confirmed ? '确认保存条件' : '核对修改'}</button></div>
    </form>
  </DialogFrame>;
}
