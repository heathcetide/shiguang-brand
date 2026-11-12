import { DialogFrame } from './DialogFrame';
import { AdminButton } from './FormControls';

export function ConfirmDialog({
  title,
  description,
  onCancel,
  onConfirm,
  busy = false,
}: {
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <DialogFrame className="admin-dialog-backdrop admin-dialog-center" aria-label={title} onClose={onCancel} busy={busy}>
      <section className="admin-confirm">
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="admin-actions">
          <AdminButton disabled={busy} onClick={onCancel}>取消</AdminButton>
          <AdminButton variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? '处理中…' : '确认'}
          </AdminButton>
        </div>
      </section>
    </DialogFrame>
  );
}
