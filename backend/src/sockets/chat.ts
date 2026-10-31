import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { config } from '../config';
import { extractBearer, userFromToken } from '../middleware/auth';
import { markRead, sendMessage } from '../services/chat';
import { HttpError } from '../utils/http';
import { setIo } from './io';

type Ack = (response: { ok: boolean; message?: unknown; error?: string }) => void;

/**
 * Chat en tiempo real. El cliente debe enviar su JWT en el handshake (auth.token);
 * un token inválido o vencido rechaza la conexión y el cliente cierra la sesión.
 */
export function attachSockets(httpServer: HttpServer): Server {
  const io = new Server(httpServer, { cors: { origin: config.frontendOrigins, credentials: true } });
  setIo(io);

  io.use(async (socket, next) => {
    try {
      const raw = (socket.handshake.auth as { token?: string } | undefined)?.token ?? extractBearer(socket.handshake.headers.authorization);
      const user = await userFromToken(raw ?? null);
      if (user.status === 'suspended') throw new HttpError(403, 'Cuenta suspendida', 'ACCOUNT_SUSPENDED');
      socket.data.user = user;
      next();
    } catch (err) {
      const code = err instanceof HttpError ? err.code : 'TOKEN_INVALID';
      next(Object.assign(new Error(code), { data: { code } }));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket.data.user as { id: string }).id;
    void socket.join(`user:${userId}`);

    socket.on('message:send', async (payload: { conversation_id?: string; body?: string }, ack?: Ack) => {
      try {
        const message = await sendMessage(String(payload?.conversation_id ?? ''), userId, String(payload?.body ?? ''));
        ack?.({ ok: true, message });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof HttpError ? err.message : 'No se pudo enviar el mensaje.' });
      }
    });

    socket.on('message:read', async (payload: { conversation_id?: string }, ack?: Ack) => {
      try {
        await markRead(String(payload?.conversation_id ?? ''), userId);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof HttpError ? err.message : 'No se pudo marcar como leído.' });
      }
    });
  });
  return io;
}
