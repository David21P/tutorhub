import { Server } from 'socket.io';

let io: Server | null = null;

export function setIo(server: Server): void {
  io = server;
}

/** Envía un evento a todas las pestañas conectadas de un usuario (sala "user:<id>"). */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Avisa a las personas involucradas que sus tutorías/suscripciones cambiaron, para que recarguen sus listas. */
export function notifyChanged(...userIds: string[]): void {
  for (const id of new Set(userIds)) emitToUser(id, 'data:changed', {});
}
