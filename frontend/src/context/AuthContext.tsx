import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ACCOUNT_STATE_EVENT, FORCE_LOGOUT_EVENT, api, getToken, setToken } from '../api/client';
import { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Mensaje mostrado en el login tras un cierre de sesión forzado (ej. token vencido) */
  notice: string | null;
  loginWithGoogle: (credential: string) => Promise<User>;
  devLogin: (email: string, name?: string) => Promise<User>;
  refresh: () => Promise<User | null>;
  setUser: (user: User) => void;
  logout: (notice?: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null);
  const [notice, setNotice] = useState<string | null>(null);

  const logout = useCallback(
    (message?: string) => {
      setToken(null);
      setUser(null);
      setNotice(message ?? null);
      navigate('/login', { replace: true });
    },
    [navigate],
  );

  const refresh = useCallback(async (): Promise<User | null> => {
    if (!getToken()) return null;
    const { data } = await api.get<{ user: User }>('/auth/me');
    setUser(data.user);
    return data.user;
  }, []);

  // Al cargar la app se recupera la sesión desde el JWT guardado
  useEffect(() => {
    if (!getToken()) return;
    refresh()
      .catch(() => undefined) // un 401 ya dispara el logout forzado
      .finally(() => setLoading(false));
  }, [refresh]);

  // Token inválido o vencido: cierre de sesión forzado y redirección
  useEffect(() => {
    const onForce = (e: Event) => {
      const code = (e as CustomEvent<{ code?: string }>).detail?.code;
      logout(code === 'TOKEN_EXPIRED' ? 'Su sesión expiró. Inicie sesión nuevamente.' : 'Su sesión ya no es válida. Inicie sesión nuevamente.');
    };
    const onAccount = () => {
      void refresh().catch(() => undefined);
    };
    window.addEventListener(FORCE_LOGOUT_EVENT, onForce);
    window.addEventListener(ACCOUNT_STATE_EVENT, onAccount);
    return () => {
      window.removeEventListener(FORCE_LOGOUT_EVENT, onForce);
      window.removeEventListener(ACCOUNT_STATE_EVENT, onAccount);
    };
  }, [logout, refresh]);

  const finishLogin = useCallback((token: string, loggedUser: User): User => {
    setToken(token);
    setNotice(null);
    setUser(loggedUser);
    return loggedUser;
  }, []);

  const loginWithGoogle = useCallback(
    async (credential: string) => {
      const { data } = await api.post<{ token: string; user: User }>('/auth/google', { credential });
      return finishLogin(data.token, data.user);
    },
    [finishLogin],
  );

  const devLogin = useCallback(
    async (email: string, name?: string) => {
      const { data } = await api.post<{ token: string; user: User }>('/auth/dev-login', { email, name });
      return finishLogin(data.token, data.user);
    },
    [finishLogin],
  );

  const value = useMemo<AuthState>(
    () => ({ user, loading, notice, loginWithGoogle, devLogin, refresh, setUser, logout }),
    [user, loading, notice, loginWithGoogle, devLogin, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
