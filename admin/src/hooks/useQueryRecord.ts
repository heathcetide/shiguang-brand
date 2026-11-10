import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { parseQueryValue } from './useQueryState';
export function useQueryRecord<T extends Record<string,string>>(defaults: T): [T, Dispatch<SetStateAction<T>>] {
  const location = useLocation(); const navigate = useNavigate();
  const state=useMemo(()=>{const params=new URLSearchParams(location.search);return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,parseQueryValue(params.get(key),value)])) as T;},[location.search,defaults]);
  return [state,next=>{const values=typeof next==='function'?next(state):next;const params=new URLSearchParams(location.search);for(const key of Object.keys(defaults)){if(values[key]===defaults[key])params.delete(key);else params.set(key,values[key]);}params.delete('page');navigate({search:params.toString()},{replace:true,preventScrollReset:true});}];
}
