/**
 * 拾味日常 UI kit tokens — elegant / dense / low-decoration.
 * Prefer these over one-off rounded-full + font-black + soft icon pills.
 */
export const ui = {
  radius: {
    control: 'rounded-lg',
    panel: 'rounded-xl',
    chip: 'rounded-md',
  },
  control: {
    sm: 'h-8 px-2.5',
    md: 'h-10 px-3.5',
    lg: 'h-11 px-4',
  },
  type: {
    pageTitle: 'text-lg font-semibold tracking-tight text-ink',
    section: 'text-xs font-medium tracking-wide text-copy-muted',
    body: 'text-sm font-medium text-ink',
    meta: 'text-xs text-copy-muted',
    label: 'text-[11px] font-medium text-copy-muted',
  },
  surface: {
    panel: 'border border-line bg-surface',
    inset: 'border border-line bg-canvas',
    page: 'bg-canvas',
  },
} as const;
