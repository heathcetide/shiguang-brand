import type { KitchenwareCapabilityConstraints } from '@dietdigidose/contracts';
import { kitchenwareFunctionLabels } from '@dietdigidose/contracts/kitchenware-options';
import { useEffect, useState } from 'react';
import api from '../services/api';
import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminSelect,
  DialogFrame,
} from '../components/admin';

type Capability = { code: string; name: string; safety_level: string };
type Draft = {
  code: string;
  capacity: string;
  diameter: string;
  heat: string;
  functions: NonNullable<KitchenwareCapabilityConstraints['requiredFunctions']>;
  invalid?: string;
};
type Configuration = { token: string; available: Capability[]; capabilities: { code: string; constraints: unknown }[] };

function draft(row: Configuration['capabilities'][number]): Draft {
  const raw = row.constraints as Record<string, unknown> | null;
  const valid =
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    Object.keys(raw).every((key) => ['minCapacityMl', 'minDiameterCm', 'heatSource', 'requiredFunctions'].includes(key)) &&
    (raw.minCapacityMl === undefined || typeof raw.minCapacityMl === 'number') &&
    (raw.minDiameterCm === undefined || typeof raw.minDiameterCm === 'number') &&
    (raw.heatSource === undefined || ['gas', 'induction', 'electric'].includes(String(raw.heatSource))) &&
    (raw.requiredFunctions === undefined ||
      (Array.isArray(raw.requiredFunctions) && raw.requiredFunctions.every((value) => Object.hasOwn(kitchenwareFunctionLabels, value))));
  const condition = valid ? (raw as KitchenwareCapabilityConstraints) : {};

  return {
    code: row.code,
    functions: condition.requiredFunctions ?? [],
    capacity: valid && condition.minCapacityMl != null ? String(condition.minCapacityMl) : '',
    diameter: valid && condition.minDiameterCm != null ? String(condition.minDiameterCm) : '',
    heat: valid ? String(condition.heatSource ?? '') : '',
    invalid: valid ? undefined : JSON.stringify(row.constraints),
  };
}

export default function KitchenwareCapabilities({
  item,
  onClose,
}: {
  item: { id: number; name: string };
  onClose: () => void;
}) {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<Configuration>(`/admin/kitchenware/catalog/${item.id}/capabilities`)
      .then(({ data }) => {
        if (!active) return;
        const normalized = {
          token: data?.token || '',
          available: Array.isArray(data?.available) ? data.available : [],
          capabilities: Array.isArray(data?.capabilities) ? data.capabilities : [],
        };
        setConfiguration(normalized);
        setRows(normalized.capabilities.map(draft));
      })
      .catch(() => {
        if (active) setMessage('加载失败，请关闭后重试');
      });
    return () => {
      active = false;
    };
  }, [item.id]);

  const change = (index: number, patch: Partial<Draft>) => {
    setConfirmed(false);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configuration || rows.some((row) => row.invalid !== undefined)) return;
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await api.put(`/admin/kitchenware/catalog/${item.id}/capabilities`, {
        token: configuration.token,
        capabilities: rows.map((row) => ({
          code: row.code,
          constraints: {
            ...(row.capacity !== '' ? { minCapacityMl: Number(row.capacity) } : {}),
            ...(row.diameter !== '' ? { minDiameterCm: Number(row.diameter) } : {}),
            ...(row.functions.length ? { requiredFunctions: row.functions } : {}),
            ...(row.heat ? { heatSource: row.heat } : {}),
          },
        })),
      });
      onClose();
    } catch (error: any) {
      setMessage(error.response?.data?.error || '保存失败');
      setConfirmed(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogFrame onClose={onClose} busy={saving} className="admin-dialog-backdrop admin-dialog-center">
      <form
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name}的能力条件`}
        className="admin-confirm max-h-[90vh] w-full max-w-2xl overflow-y-auto"
      >
        <h2>
          {item.name} · 能力条件
        </h2>
        <p className="admin-muted">
          仅登记核实过的能力。条件用于所有用户的推荐判断，须由同一件设备满足；留空表示该项没有额外限制。受限能力不会自动放行。
        </p>
        {message && (
          <p role="alert" className="admin-error">
            {message}
          </p>
        )}
        {!configuration && !message && <p className="admin-muted">加载中…</p>}
        <fieldset disabled={saving} className="admin-form-stack">
          {rows.map((row, index) => (
            <div key={row.code} className="admin-panel space-y-3 p-3">
              <div className="flex items-center justify-between">
                <strong>{configuration?.available.find((capability) => capability.code === row.code)?.name ?? row.code}</strong>
                <AdminButton
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setRows((current) => current.filter((_, i) => i !== index));
                    setConfirmed(false);
                  }}
                >
                  移除能力
                </AdminButton>
              </div>
              {row.invalid !== undefined ? (
                <p className="admin-error text-sm">
                  存在无法识别的旧条件：{row.invalid}。请核对后移除并重新登记，不能静默覆盖。
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <AdminField label="最低容量（毫升）">
                    <AdminInput
                      type="number"
                      min="0.001"
                      max="1000000"
                      step="any"
                      value={row.capacity}
                      onChange={(event) => change(index, { capacity: event.target.value })}
                    />
                  </AdminField>
                  <AdminField label="最小直径（厘米）">
                    <AdminInput
                      type="number"
                      min="0.001"
                      max="1000"
                      step="any"
                      value={row.diameter}
                      onChange={(event) => change(index, { diameter: event.target.value })}
                    />
                  </AdminField>
                  <fieldset className="sm:col-span-3">
                    <legend className="admin-muted text-sm">必须具备的电器功能（同一设备）</legend>
                    {(Object.keys(kitchenwareFunctionLabels) as Array<keyof typeof kitchenwareFunctionLabels>).map((value) => (
                      <label key={value} className="mr-4 text-sm">
                        <input
                          type="checkbox"
                          checked={(row.functions ?? []).includes(value)}
                          onChange={(event) =>
                            change(index, {
                              functions: event.target.checked
                                ? [...(row.functions ?? []), value]
                                : (row.functions ?? []).filter((item) => item !== value),
                            })
                          }
                        />
                        {kitchenwareFunctionLabels[value]}
                      </label>
                    ))}
                  </fieldset>
                  <AdminField label="所需热源">
                    <AdminSelect value={row.heat} onChange={(event) => change(index, { heat: event.target.value })}>
                      <option value="">无额外限制</option>
                      <option value="gas">燃气</option>
                      <option value="induction">电磁炉</option>
                      <option value="electric">电热</option>
                    </AdminSelect>
                  </AdminField>
                </div>
              )}
            </div>
          ))}
          {configuration && (
            <AdminField label="添加已核实能力">
              <AdminSelect
                value=""
                onChange={(event) => {
                  if (event.target.value) {
                    setRows((current) => [
                      ...current,
                      { code: event.target.value, capacity: '', diameter: '', heat: '', functions: [] },
                    ]);
                    setConfirmed(false);
                  }
                }}
              >
                <option value="">选择能力</option>
                {(configuration?.available ?? [])
                  .filter((capability) => !rows.some((row) => row.code === capability.code))
                  .map((capability) => (
                    <option key={capability.code} value={capability.code}>
                      {capability.name}
                      {capability.safety_level === 'restricted' ? '（受限）' : ''}
                    </option>
                  ))}
              </AdminSelect>
            </AdminField>
          )}
        </fieldset>
        {confirmed && (
          <p className="admin-muted rounded-lg bg-amber-50 p-3 text-sm">
            将保存当前 {rows.length} 项能力及条件，并影响使用此目录的推荐判断。确认所有修改后提交。
          </p>
        )}
        <div className="admin-actions justify-end">
          <AdminButton type="button" disabled={saving} onClick={onClose}>
            取消
          </AdminButton>
          <AdminButton
            type="submit"
            variant="primary"
            disabled={!configuration || saving || rows.some((row) => row.invalid !== undefined)}
          >
            {saving ? '保存中…' : confirmed ? '确认保存条件' : '核对修改'}
          </AdminButton>
        </div>
      </form>
    </DialogFrame>
  );
}
