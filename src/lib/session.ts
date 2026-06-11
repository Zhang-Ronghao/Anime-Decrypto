export interface Session {
  user: {
    id: string;
  };
}

type AuthChangeCallback = (_event: 'SIGNED_IN', session: Session | null) => void;

const listeners = new Set<AuthChangeCallback>();
let cachedSession: Session | null = null;
const SESSION_STORAGE_KEY = 'decrypto-session-id';

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
}

export const isBackendConfigured = true;

export const backendAuth = {
  auth: {
    onAuthStateChange(callback: AuthChangeCallback) {
      listeners.add(callback);
      if (cachedSession) {
        window.queueMicrotask(() => callback('SIGNED_IN', cachedSession));
      }

      return {
        data: {
          subscription: {
            unsubscribe() {
              listeners.delete(callback);
            },
          },
        },
      };
    },
  },
};

function getStoredSessionId(): string {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return existing;
  }

  const next = crypto.randomUUID();
  localStorage.setItem(SESSION_STORAGE_KEY, next);
  return next;
}

export function getSessionIdForRequest(): string {
  return cachedSession?.user.id ?? getStoredSessionId();
}

export async function ensureSession(): Promise<Session | null> {
  const sessionId = getStoredSessionId();
  const response = await fetch(`${apiBase()}/api/session?session=${encodeURIComponent(sessionId)}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Cloudflare 匿名会话创建失败。');
  }

  const session = (await response.json()) as Session;
  cachedSession = session;
  for (const listener of listeners) {
    listener('SIGNED_IN', session);
  }

  return session;
}
