import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, authEvents } from '../services/api';

export type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';
export interface SessionUser {
  id: string;
  role: Role;
  fullName: string;
  language: string;
}
type Portal = 'patient' | 'doctor' | 'admin';

interface AuthState {
  /** undefined = still loading, null = logged out */
  user: SessionUser | null | undefined;
  login(portal: Portal, identifier: string, password: string, totp?: string): Promise<SessionUser>;
  setSession(user: SessionUser): void;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

/**
 * Holds only the display identity returned by /auth/me. It is NOT a security
 * boundary: every API call is authorized server-side from the session cookie.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: SessionUser }>('/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setUser(null);
    authEvents.addEventListener('unauthorized', onUnauthorized);
    return () => authEvents.removeEventListener('unauthorized', onUnauthorized);
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      async login(portal, identifier, password, totp) {
        const r = await api.post<{ user: SessionUser }>(`/auth/${portal}/login`, { identifier, password, totp });
        setUser(r.user);
        return r.user;
      },
      setSession: (u) => setUser(u),
      async logout() {
        try {
          await api.post('/auth/logout');
        } finally {
          setUser(null);
        }
      },
      refresh,
    }),
    [user, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
