import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { Socket, io } from 'socket.io-client';
import { API_URL, FORCE_LOGOUT_EVENT, getToken } from '../api/client';
import { useAuth } from './AuthContext';

const SocketContext = createContext<Socket | null>(null);

/** Conexión Socket.io autenticada con el JWT; se abre solo para usuarios activos y con perfil completo. */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const enabled = Boolean(user && user.status === 'active' && user.onboarded && user.role !== 'admin');

  useEffect(() => {
    if (!enabled) return;
    const s = io(API_URL || undefined, { auth: (cb) => cb({ token: getToken() }), transports: ['websocket', 'polling'] });
    s.on('connect_error', (err) => {
      if (err.message === 'TOKEN_EXPIRED' || err.message === 'TOKEN_INVALID') {
        s.close();
        window.dispatchEvent(new CustomEvent(FORCE_LOGOUT_EVENT, { detail: { code: err.message } }));
      }
    });
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
    };
  }, [enabled, user?.id]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = (): Socket | null => useContext(SocketContext);
