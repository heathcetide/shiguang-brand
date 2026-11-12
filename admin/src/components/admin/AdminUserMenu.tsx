import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import { AdminAvatar } from './AdminAvatar';
import { cn } from '../../utils/cn';

type AdminUserMenuProps = {
  name: string;
  onLogout: () => void;
};

export function AdminUserMenu({ name, onLogout }: AdminUserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

return (
    <div ref={rootRef} className={cn('admin-user-menu', open && 'is-open')}>
      {open && (
        <div id={menuId} className="admin-user-menu-panel" role="menu">
          <Link
            to="/change-password"
            role="menuitem"
            className="admin-footer-link"
            onClick={() => setOpen(false)}
          >
            <KeyRound size={18} aria-hidden="true" />
            修改密码
          </Link>
          <button type="button" role="menuitem" className="admin-footer-link is-logout" onClick={onLogout}>
            <LogOut size={18} aria-hidden="true" />
            退出登录
          </button>
        </div>
      )}
      <button
        type="button"
        className="admin-user-menu-trigger"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`账户菜单：${name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <AdminAvatar name={name} />
        <span className="admin-user-menu-meta">
          <strong>{name}</strong>
          <small>管理员</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" className={cn('admin-user-menu-chevron', open && 'rotate-180')} />
      </button>
    </div>
  );
}
