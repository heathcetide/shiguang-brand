import { useCallback, useEffect, useRef, useState } from 'react';
export interface RemoteState<T> { data: T | null; loading: boolean; error: string; updatedAt: string | null }
export function remoteSuccess<T>(data: T, now = new Date().toISOString()): RemoteState<T> {
  return { data, loading: false, error: '', updatedAt: now };
}
export function remoteFailure<T>(previous: RemoteState<T>): RemoteState<T> {
  return { ...previous, loading: false, error: '读取失败，请重试。' };
}
export function useRemoteSection<T>(load: () => Promise<T>) {
  const [state, setState] = useState<RemoteState<T>>({ data: null, loading: true, error: '', updatedAt: null });
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const id = ++generation.current;
    setState(old => ({ ...old, loading: true, error: '' }));
    try { const data = await load(); if (id === generation.current) setState(remoteSuccess(data)); }
    catch { if (id === generation.current) setState(remoteFailure); }
  }, [load]);
  useEffect(() => { const counter = generation; void reload(); return () => { counter.current++; }; }, [reload]);
  return { ...state, reload };
}
