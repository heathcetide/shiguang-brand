import type { KitchenwareCapabilityConstraints } from '@dietdigidose/contracts';
import { kitchenwareFunctionLabels } from '@dietdigidose/contracts/kitchenware-options';
import { useEffect, useState, type FormEvent } from 'react';
import api from '@/services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { AdminButton, AdminField, AdminInput, AdminSelect } from '@/components/admin';
import { cn } from '@/utils/cn';

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

  const save = async (event: FormEvent) => {
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
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setMessage(err.response?.data?.error || '保存失败');
      setConfirmed(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" showClose={!saving}>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{item.name} · 能力条件</DialogTitle>
            <DialogDescription>
              仅登记核实过的能力。条件用于所有用户的推荐判断，须由同一件设备满足；留空表示该项没有额外限制。受限能力不会自动放行。
            </DialogDescription>
          </DialogHeader>

          {message ? (
            <p role="alert" className="text-destructive text-sm">
              {message}
            </p>
          ) : null}
          {!configuration && !message ? <p className="text-muted-foreground text-sm">加载中…</p> : null}

          <fieldset disabled={saving} className="grid gap-3">
            {rows.map((row, index) => (
              <Card key={row.code} className="gap-0 py-0">
                <CardHeader className="flex flex-row items-center justify-between gap-2 border-b py-3">
                  <CardTitle className="text-sm">
                    {configuration?.available.find((capability) => capability.code === row.code)?.name ?? row.code}
                  </CardTitle>
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
                </CardHeader>
                <CardContent className="space-y-3 py-4">
                  {row.invalid !== undefined ? (
                    <p className="text-destructive text-sm">
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
                        <legend className="text-muted-foreground mb-2 text-xs">必须具备的电器功能（同一设备）</legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {(Object.keys(kitchenwareFunctionLabels) as Array<keyof typeof kitchenwareFunctionLabels>).map((value) => (
                            <label key={value} className="flex items-center gap-1.5 text-sm">
                              <input
                                type="checkbox"
                                className="accent-primary size-3.5 rounded border-input"
                                checked={(row.functions ?? []).includes(value)}
                                onChange={(event) =>
                                  change(index, {
                                    functions: event.target.checked
                                      ? [...(row.functions ?? []), value]
                                      : (row.functions ?? []).filter((entry) => entry !== value),
                                  })
                                }
                              />
                              {kitchenwareFunctionLabels[value]}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <AdminField label="所需热源" className="sm:col-span-3 sm:max-w-xs">
                        <AdminSelect value={row.heat} onChange={(event) => change(index, { heat: event.target.value })}>
                          <option value="">无额外限制</option>
                          <option value="gas">燃气</option>
                          <option value="induction">电磁炉</option>
                          <option value="electric">电热</option>
                        </AdminSelect>
                      </AdminField>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {configuration ? (
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
            ) : null}
          </fieldset>

          {confirmed ? (
            <p className="border-amber-200/80 bg-amber-50 text-amber-900 rounded-lg border px-3 py-2 text-sm">
              将保存当前 {rows.length} 项能力及条件，并影响使用此目录的推荐判断。确认所有修改后提交。
            </p>
          ) : null}

          <Separator />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={!configuration || saving || rows.some((row) => row.invalid !== undefined)}
              className={cn(saving && 'opacity-70')}
            >
              {saving ? '保存中…' : confirmed ? '确认保存条件' : '核对修改'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}