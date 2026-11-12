import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

/** Shared admin select styled by admin.css (.admin-filter-bar / .admin-field). */
export function AdminSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn('admin-field', className)}>
      {children}
    </select>
  );
}

export function AdminInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('admin-field', className)} />;
}

export function AdminField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('admin-field-label', className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function AdminPagination({
  page,
  pageSize,
  total,
  onChange,
  disabled,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);
  return (
    <div className="admin-pagination" role="navigation" aria-label="分页">
      <span className="admin-muted text-sm">
        显示 {from}–{to} / 共 {total.toLocaleString()} 条 · 第 {safePage} / {pageCount} 页
      </span>
      <div className="admin-actions">
        <button
          type="button"
          className="admin-button"
          disabled={disabled || safePage <= 1}
          onClick={() => onChange(safePage - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className="admin-button"
          disabled={disabled || safePage >= pageCount}
          onClick={() => onChange(safePage + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function AdminButton({
  variant = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  return (
    <button
      {...props}
      className={cn(
        'admin-button',
        variant === 'primary' && 'admin-button-primary',
        variant === 'danger' && 'admin-button-danger',
        className,
      )}
    />
  );
}
