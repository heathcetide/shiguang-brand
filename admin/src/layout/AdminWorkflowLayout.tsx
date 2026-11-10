import { useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { activeWorkflowTab, adminWorkflows, workflowTabHref, type AdminWorkflow } from '../navigation/adminWorkflows';

// Route-backed navigation keeps old bookmarks, filters, and browser history intact.
// Each destination retains its own filters instead of leaking them to another API.
export default function AdminWorkflowLayout({ workflow }: { workflow: AdminWorkflow }) {
  const location = useLocation();
  const remembered = useRef<Record<string, { search: string; hash: string }>>({});
  remembered.current[location.pathname.replace(/\/$/, '')] = { search: location.search, hash: location.hash };
  const { label, tabs } = adminWorkflows[workflow];
  const active = activeWorkflowTab(tabs, location.pathname, location.search);
  return <div className="admin-stack">
    <nav aria-label={label} className="flex flex-wrap gap-2 rounded-xl bg-white p-2 shadow-sm">
      {tabs.map((tab, index) => {
        const saved = remembered.current[tab.path];
        return <Link key={`${tab.path}-${index}`} to={workflowTabHref(tab, saved?.search, saved?.hash)}
          aria-current={active === index ? 'page' : undefined}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${active === index ? 'bg-primary text-white' : 'text-text-muted hover:text-text-main'}`}>
          {tab.label}
        </Link>;
      })}
    </nav>
    <Outlet />
  </div>;
}
