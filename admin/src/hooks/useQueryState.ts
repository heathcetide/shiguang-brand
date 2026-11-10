import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { Dispatch, SetStateAction } from 'react';
export function parseQueryValue<T extends string>(value: string | null, fallback: T, allowed?: readonly string[] | ((value: string) => boolean)): T {
  return value !== null && (!allowed || (typeof allowed === 'function' ? allowed(value) : allowed.includes(value))) ? value.slice(0, 500) as T : fallback;
}
// Read current query values on every render; malformed bookmark values use the
// page default without forwarding unsupported filters to the API.
export function useQueryState<T extends string>(key: string, fallback: T, allowed?: readonly string[] | ((value: string) => boolean)): [T, Dispatch<SetStateAction<T>>] {
  const location = useLocation();
  const navigate = useNavigate();
  const current = useRef(location);
  current.current = location;
  const value = parseQueryValue(new URLSearchParams(location.search).get(key), fallback, allowed);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const params = new URLSearchParams(current.current.search);
    const old = parseQueryValue(params.get(key), fallback, allowed);
    const resolved = typeof next === 'function' ? next(old) : next;
    if (resolved === fallback) params.delete(key); else params.set(key, resolved);
    params.delete('cursor'); params.delete('page');
    navigate({ pathname: current.current.pathname, search: params.toString() }, { replace: true, preventScrollReset: true });
  }, [key, fallback, allowed, navigate]);
  return [value, setValue];
}

export function useQueryNumber(key: string, fallback: number, allowed: readonly number[]): [number, Dispatch<SetStateAction<number>>] {
  const [raw, setRaw] = useQueryState<string>(key, String(fallback), allowed.map(String));
  return [Number(raw), next => setRaw(previous => String(typeof next === 'function' ? next(Number(previous)) : next))];
}
