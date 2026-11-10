import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { DialogFrame } from './DialogFrame';
export function DetailPanel({ title, children, onClose, dirty = false, busy = false }: { title: string; children: ReactNode; onClose: () => void; dirty?: boolean; busy?: boolean }) {
  const close = () => { if (!busy) onClose(); };
  return <DialogFrame className="admin-dialog-backdrop" aria-label={title} onClose={onClose} dirty={dirty} busy={busy}><section className="admin-detail-panel"><header className="admin-panel-heading"><h2>{title}</h2><button aria-label="关闭详情" className="admin-button" disabled={busy} onClick={close}><X size={18}/></button></header><div className="admin-detail-body">{children}</div></section></DialogFrame>;
}
