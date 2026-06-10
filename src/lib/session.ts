export interface Session {
  user: {
    id: string;
  };
}

type AuthChangeCallback = (_event: 'SIGNED_IN', session: Session | null) => void;

const listeners = new Set<AuthChangeCallback>();
let cachedSession: Session | null = null;

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

export async function ensureSession(): Promise<Session | null> {
  const response = await fetch(`${apiBase()}/api/session`, {
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
