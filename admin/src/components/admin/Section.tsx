import type { ReactNode } from 'react';
import type { RemoteState } from '../../hooks/useRemoteSection';
export function Section<T>({ title, icon, state, children, action }: { title: string; icon?: ReactNode; state?: RemoteState<T> & { reload: () => void }; children: ReactNode; action?: ReactNode }) {
  return <section className="admin-panel"><header className="admin-panel-heading"><h2>{icon && <span className="admin-panel-icon" aria-hidden="true">{icon}</span>}{title}</h2><div className="admin-actions">{action}{state && <button type="button" className="admin-button" onClick={state.reload} disabled={state.loading}>刷新</button>}</div></header>
    {state?.error && <p role="alert" className="admin-error">{state.error}{state.data !== null && ' 当前保留上次读取的数据。'}</p>}
    {state?.loading && <p role="status" className="admin-muted">正在读取…</p>}
    {(!state || state.data !== null) && children}
    {state?.updatedAt && <p className="admin-updated">更新于 {new Date(state.updatedAt).toLocaleString('zh-CN')}</p>}
  </section>;
}
