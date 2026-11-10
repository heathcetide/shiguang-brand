import type { ReactNode } from 'react';
export function FilterBar({ children }: { children: ReactNode }) { return <div className="admin-filter-bar" role="search" aria-label="列表筛选">{children}</div>; }
export function TableContainer({ children }: { children: ReactNode }) { return <div className="admin-table-container" tabIndex={0} role="region" aria-label="数据列表">{children}</div>; }
export function EmptyState({ children = '没有符合条件的记录。' }: { children?: ReactNode }) { return <p className="admin-empty">{children}</p>; }
