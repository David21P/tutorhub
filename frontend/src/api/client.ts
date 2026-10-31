import axios, { AxiosError } from 'axios';

export const TOKEN_KEY = 'tutorhub.token';
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (token: string | null): void => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
};

export interface ApiErrorBody {
  error: string;
  code: string;
  message: string;
  details?: unknown;
}

/** Evento global: el interceptor lo emite y AuthContext cierra la sesión y redirige al login. */
export const FORCE_LOGOUT_EVENT = 'tutorhub:force-logout';
export const ACCOUNT_STATE_EVENT = 'tutorhub:account-state';

export const api = axios.create({ baseURL: `${API_URL}/api` });

// Todas las peticiones llevan el JWT en el header Authorization
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

// 401 (token faltante, inválido o vencido) => logout forzado y redirección al login
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const isLoginCall = error.config?.url?.startsWith('/auth/google') || error.config?.url?.startsWith('/auth/dev-login');
    if (status === 401 && !isLoginCall) {
      window.dispatchEvent(new CustomEvent(FORCE_LOGOUT_EVENT, { detail: { code } }));
    } else if (status === 403 && (code === 'ACCOUNT_SUSPENDED' || code === 'ONBOARDING_REQUIRED')) {
      window.dispatchEvent(new CustomEvent(ACCOUNT_STATE_EVENT, { detail: { code } }));
    }
    return Promise.reject(error);
  },
);

/** Mensaje legible de cualquier error de la API. */
export function errorMessage(err: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (axios.isAxiosError<ApiErrorBody>(err)) {
    if (!err.response) return 'No se pudo conectar con el servidor.';
    return err.response.data?.message ?? fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

export function errorCode(err: unknown): string | undefined {
  return axios.isAxiosError<ApiErrorBody>(err) ? err.response?.data?.code : undefined;
}
