import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Menu } from 'lucide-react';
import { ThemeSwitch } from '../ThemeSwitch';
import { AdminButton } from './FormControls';

type Breadcrumb = {
  groupLabel?: string;
  pageLabel?: string;
  showPage: boolean;
};

type AdminTopbarProps = {
  breadcrumb: Breadcrumb;
  onOpenMenu: () => void;
  trailing?: ReactNode;
};

export function AdminTopbar({ breadcrumb, onOpenMenu, trailing }: AdminTopbarProps) {
  return (
    <header className="admin-topbar">
      <AdminButton type="button" className="admin-menu-button" aria-label="打开菜单" onClick={onOpenMenu}>
        <Menu size={18} />
      </AdminButton>
      <nav aria-label="面包屑">
        <Link to="/admin">工作台</Link>
        {breadcrumb.groupLabel && (
          <>
            <span>/</span>
            <span>{breadcrumb.groupLabel}</span>
          </>
        )}
        {breadcrumb.showPage && (
          <>
            <span>/</span>
            <span aria-current="page">{breadcrumb.pageLabel || '页面'}</span>
          </>
        )}
      </nav>
      <div className="admin-topbar-identity">
        <ThemeSwitch />
        {trailing}
      </div>
    </header>
  );
}
