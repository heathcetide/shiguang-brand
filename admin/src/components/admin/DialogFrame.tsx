import { useEffect, useRef, type HTMLAttributes } from 'react';
// Reuses existing page content and mutation handlers while standardizing keyboard
// behavior. The last mounted dialog owns focus, including nested confirmations.
const stack: HTMLElement[] = [];
export function DialogFrame({ onClose, dirty, busy = false, children, ...props }: HTMLAttributes<HTMLDivElement> & { onClose: () => void; dirty?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const edited = useRef(false);
  const latest = useRef({ onClose, dirty, busy }); latest.current = { onClose, dirty, busy };
  const close = () => { const s = latest.current; if (!s.busy && (!(s.dirty ?? edited.current) || window.confirm('有未保存的内容，确定放弃修改吗？'))) s.onClose(); };
  useEffect(() => {
    const node = ref.current!; const previous = document.activeElement as HTMLElement | null;
    stack.push(node);
    const focusable = () => Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(el => el.getClientRects().length > 0);
    (focusable()[0] || node).focus();
    const key = (event: KeyboardEvent) => {
      if (stack.at(-1) !== node) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0] || node; const last = items.at(-1) || node;
        if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const focus = (event: FocusEvent) => { if (stack.at(-1) === node && !node.contains(event.target as Node)) (focusable()[0] || node).focus(); };
    document.addEventListener('keydown', key, true); document.addEventListener('focusin', focus);
    return () => { stack.splice(stack.indexOf(node), 1); document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', focus); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div {...props} ref={ref} role="dialog" aria-modal="true" aria-label={props['aria-label'] || '详情与操作'} tabIndex={-1} onInputCapture={() => { edited.current = true; }} onClickCapture={event => {
    const button = (event.target as Element).closest('button');
    if (!button || !(button.textContent?.trim().match(/^(取消|关闭|关闭详情)$/) || button.getAttribute('aria-label')?.startsWith('关闭') || button.querySelector('svg.lucide-x'))) return;
    if (latest.current.busy || ((latest.current.dirty ?? edited.current) && !window.confirm('有未保存的内容，确定放弃修改吗？'))) { event.preventDefault(); event.stopPropagation(); }
    else edited.current = false;
  }} onClick={event => { if (event.target === event.currentTarget) close();  }}>{children}</div>;
}
