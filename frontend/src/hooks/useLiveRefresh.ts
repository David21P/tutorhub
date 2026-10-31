import { useEffect } from 'react';
import { useSocket } from '../context/SocketContext';

/** Vuelve a cargar los datos de una pantalla cuando el servidor avisa de un cambio (o al reconectar el socket). */
export function useLiveRefresh(reload: () => void): void {
  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    const run = () => reload();
    socket.on('data:changed', run);
    socket.io.on('reconnect', run);
    return () => {
      socket.off('data:changed', run);
      socket.io.off('reconnect', run);
    };
  }, [socket, reload]);
}
