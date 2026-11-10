import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { getChatSessionStore, type MessageUpdate, type SessionCheck } from "./chatSessionStore";
import type { Message } from "./types";

export function useChatSessions(userId: number | undefined, generation: number, isSessionCurrent: SessionCheck) {
  const store = useMemo(() => getChatSessionStore(userId, generation, isSessionCurrent), [userId, generation, isSessionCurrent]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [selection, setSelection] = useState(() => ({ store, id: "" }));
  const [draftId] = useState(() => Crypto.randomUUID());
  const currentSessionId = selection.store === store && selection.id ? selection.id : snapshot.sessions[0]?.id || draftId;
  useEffect(() => {
    let active = true;
    void store.load().then(() => {
      if (!active || !store.isCurrent()) return;
      setSelection(current => current.store === store && current.id ? current
        : { store, id: store.getSnapshot().sessions[0]?.id || draftId });
    });
    return () => { active = false; };
  }, [draftId, store]);

  const setMessages = useCallback((update: MessageUpdate) => store.updateMessages(currentSessionId, update), [currentSessionId, store]);
  const updateSessionMessages = useCallback((sessionId: string, update: MessageUpdate) => store.updateMessages(sessionId, update), [store]);
  const selectSession = useCallback((id: string) => {
    if (store.isCurrent()) setSelection({ store, id });
  }, [store]);
  const startSession = useCallback((id = Crypto.randomUUID(), messages: Message[] = []) => {
    if (!store.isCurrent()) return;
    if (messages.length) store.updateMessages(id, messages);
    setSelection({ store, id });
  }, [store]);
  const removeSession = useCallback((id: string) => {
    if (!store.removeSession(id)) return;
    setSelection(current => current.store === store && current.id === id
      ? { store, id: store.getSnapshot().sessions[0]?.id || Crypto.randomUUID() } : current);
  }, [store]);
  return {
    ready: snapshot.ready, error: snapshot.error, sessions: snapshot.sessions,
    messages: snapshot.sessions.find(session => session.id === currentSessionId)?.messages ?? [],
    currentSessionId, setMessages, updateSessionMessages, selectSession, startSession, removeSession,
  };
}
