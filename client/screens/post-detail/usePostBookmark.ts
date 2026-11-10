import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { communityApi } from "@/services/api";

// Keep confirmed server state only. A failed request may have reached the server,
// so a fresh read is required before another desired-state write.
export function usePostBookmark(postId: number | undefined, initial: boolean | undefined, reload: () => Promise<void>, revision: number, readFence: { readGeneration: number; writeGeneration: MutableRefObject<number> }) {
  const { user, isAuthenticated, sessionGeneration, isSessionCurrent } = useAuth();
  const authFetch = useAuthFetch();
  const { readGeneration, writeGeneration } = readFence;
  const scope = `${sessionGeneration}:${user?.id}:${postId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(true);
  const pendingRef = useRef<string | null>(null);
  const [state, setState] = useState({ scope, bookmarked: Boolean(initial), pending: false, known: initial !== undefined });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    // A detail read started before this write must not unlock or overwrite it.
    if (pendingRef.current === scope || (initial !== undefined && readGeneration !== writeGeneration.current)) return;
    pendingRef.current = null;
    setState({ scope, bookmarked: Boolean(initial), pending: false, known: initial !== undefined });
  }, [scope, initial, revision, readGeneration, writeGeneration]);
  const current = state.scope === scope ? state : { bookmarked: false, pending: false, known: false };
  const setBookmark = useCallback(async () => {
    if (!postId || !user || !isAuthenticated || !current.known || pendingRef.current === scope
      || !isSessionCurrent(user.id, sessionGeneration)) return;
    pendingRef.current = scope;
    writeGeneration.current += 1;
    const desired = !current.bookmarked;
    const valid = () => mounted.current && scopeRef.current === scope && isSessionCurrent(user.id, sessionGeneration);
    setState({ scope, bookmarked: current.bookmarked, known: true, pending: true });
    try {
      const result = await communityApi.setBookmark(authFetch, postId, desired);
      if (valid()) {
        // Reads begun before or during the write cannot overwrite its confirmed result.
        writeGeneration.current += 1;
        setState({ scope, bookmarked: result.bookmarked, known: true, pending: false });
      }
    } catch (error) {
      if (valid()) {
        writeGeneration.current += 1;
        setState({ scope, bookmarked: current.bookmarked, known: false, pending: true });
        pendingRef.current = null;
        await reload();
        if (valid()) throw error;
      }
    } finally {
      if (pendingRef.current === scope) pendingRef.current = null;
      if (valid()) setState(previous => ({ ...previous, pending: false }));
    }
  }, [postId, user, isAuthenticated, current.known, current.bookmarked, scope, isSessionCurrent, sessionGeneration, authFetch, reload, writeGeneration]);
  return { ...current, bookmarked: isAuthenticated && current.bookmarked, setBookmark };
}
