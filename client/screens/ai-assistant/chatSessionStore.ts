import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHAT_SESSIONS_STORAGE_KEY, getPrivateStorageGeneration, getUserStorageKey, writeUserPrivateStorage } from "@/utils/userStorage";
import type { ChatSession, Message } from "./types";

export type SessionCheck = (userId: number, generation: number) => boolean;
export type MessageUpdate = Message[] | ((messages: Message[]) => Message[]);
type Snapshot = { ready: boolean; sessions: ChatSession[]; error?: string };

// Reads and writes share the same queue, including across screen remounts and logins.
const storageTails = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (storageTails.get(key) ?? Promise.resolve()).then(operation, operation);
  const tail = result.catch(() => undefined);
  storageTails.set(key, tail);
  void tail.then(() => { if (storageTails.get(key) === tail) storageTails.delete(key); });
  return result;
}

export class ChatSessionStore {
  private snapshot: Snapshot = { ready: false, sessions: [] };
  private listeners = new Set<() => void>();
  private deleted = new Set<string>();
  private loading?: Promise<void>;
  private readonly privateGeneration: number;
  readonly storageKey: string | null;

  constructor(readonly userId: number | undefined, readonly generation: number, private readonly sessionCheck: SessionCheck) {
    this.storageKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, userId);
    this.privateGeneration = userId ? getPrivateStorageGeneration(userId) : 0;
  }

  isCurrent = () => Boolean(this.userId && this.sessionCheck(this.userId, this.generation)
    && getPrivateStorageGeneration(this.userId) === this.privateGeneration);
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: Snapshot) { this.snapshot = snapshot; this.listeners.forEach(listener => listener()); }

  load = () => {
    if (this.loading) return this.loading;
    if (!this.storageKey) return Promise.resolve();
    this.loading = enqueue(this.storageKey, async () => {
      if (!this.isCurrent()) return;
      const saved = await AsyncStorage.getItem(this.storageKey!);
      if (!this.isCurrent()) return;
      let sessions: ChatSession[] = [];
      try {
        const parsed = saved ? JSON.parse(saved) : [];
        if (Array.isArray(parsed)) sessions = parsed.filter(session => typeof session?.id === "string" && Array.isArray(session.messages));
      } catch { /* Keep the existing behavior for malformed historical caches. */ }
      this.publish({ ready: true, sessions });
    }).catch(error => {
      if (this.isCurrent()) this.publish({ ...this.snapshot, error: error instanceof Error ? error.message : "会话读取失败" });
      this.loading = undefined;
    });
    return this.loading;
  };

  updateMessages = (sessionId: string, update: MessageUpdate) => {
    if (!this.isCurrent() || !this.snapshot.ready || this.deleted.has(sessionId)) return false;
    const previous = this.snapshot.sessions.find(session => session.id === sessionId);
    const messages = typeof update === "function" ? update(previous?.messages ?? []) : update;
    if (!previous && !messages.length) return false;
    const first = messages.find(message => message.sender === "user")?.text || "与食语的对话";
    const next: ChatSession = {
      id: sessionId, title: first.length > 14 ? `${first.slice(0, 14)}...` : first,
      updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), messages,
    };
    const sessions = previous ? this.snapshot.sessions.map(session => session.id === sessionId ? next : session) : [next, ...this.snapshot.sessions];
    this.publish({ ready: true, sessions });
    this.persist();
    return true;
  };

  removeSession = (sessionId: string) => {
    if (!this.isCurrent() || !this.snapshot.ready) return false;
    this.deleted.add(sessionId);
    this.publish({ ready: true, sessions: this.snapshot.sessions.filter(session => session.id !== sessionId) });
    this.persist();
    return true;
  };

  private persist() {
    if (!this.storageKey || !this.userId) return;
    void enqueue(this.storageKey, async () => {
      if (!this.isCurrent()) return;
      // Serialize the latest shared snapshot, never an earlier render's full array.
      await writeUserPrivateStorage(CHAT_SESSIONS_STORAGE_KEY, this.userId!, this.privateGeneration, JSON.stringify(this.snapshot.sessions));
    }).catch(error => {
      if (this.isCurrent()) this.publish({ ...this.snapshot, error: error instanceof Error ? error.message : "会话保存失败" });
    });
  }

  flush = () => this.storageKey ? (storageTails.get(this.storageKey) ?? Promise.resolve()) : Promise.resolve();
}

const stores = new WeakMap<SessionCheck, Map<number | undefined, ChatSessionStore>>();
export function getChatSessionStore(userId: number | undefined, generation: number, sessionCheck: SessionCheck) {
  const owners = stores.get(sessionCheck) ?? new Map<number | undefined, ChatSessionStore>();
  stores.set(sessionCheck, owners);
  let store = owners.get(userId);
  if (!store || store.generation !== generation || !store.isCurrent()) {
    store = new ChatSessionStore(userId, generation, sessionCheck);
    owners.set(userId, store);
  }
  return store;
}
