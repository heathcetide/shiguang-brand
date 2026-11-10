import type { ReactNode } from 'react';
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="admin-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="admin-actions">{actions}</div>}</header>;
}
