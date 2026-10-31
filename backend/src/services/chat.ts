import { query, queryOne } from '../db/pool';
import { emitToUser } from '../sockets/io';
import { badRequest, forbidden, notFound } from '../utils/http';

export interface Conversation {
  id: string;
  student_id: string;
  tutor_id: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: Date;
  read_at: Date | null;
  is_system?: boolean;
}

/** Carga una conversación verificando que el usuario sea uno de sus dos participantes. */
export async function loadConversation(conversationId: string, userId: string): Promise<Conversation> {
  const conv = await queryOne<Conversation>(
    'SELECT id, student_id, tutor_id FROM conversations WHERE id = $1',
    [conversationId],
  );
  if (!conv) throw notFound('Conversación no encontrada.');
  if (conv.student_id !== userId && conv.tutor_id !== userId) throw forbidden('No participa en esta conversación.');
  return conv;
}

export const otherParticipant = (conv: Conversation, userId: string): string =>
  conv.student_id === userId ? conv.tutor_id : conv.student_id;

/** Guarda el mensaje y lo entrega en tiempo real a ambos participantes. */
export async function sendMessage(conversationId: string, senderId: string, body: string): Promise<MessageRow> {
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) throw badRequest('El mensaje debe tener entre 1 y 2000 caracteres.');
  const conv = await loadConversation(conversationId, senderId);
  const message = await queryOne<MessageRow>(
    `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
     RETURNING id, conversation_id, sender_id, body, created_at, read_at, is_system`,
    [conversationId, senderId, text],
  );
  if (!message) throw new Error('No se pudo guardar el mensaje');
  await query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [conversationId, message.created_at]);
  emitToUser(conv.student_id, 'message:new', message);
  if (conv.tutor_id !== conv.student_id) emitToUser(conv.tutor_id, 'message:new', message);
  return message;
}

/** Marca como leídos los mensajes recibidos y avisa al remitente (confirmación de lectura). */
export async function markRead(conversationId: string, readerId: string): Promise<number> {
  const conv = await loadConversation(conversationId, readerId);
  const rows = await query<{ id: string }>(
    `UPDATE messages SET read_at = now()
      WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL RETURNING id`,
    [conversationId, readerId],
  );
  if (rows.length > 0) {
    emitToUser(otherParticipant(conv, readerId), 'message:read', {
      conversation_id: conversationId,
      reader_id: readerId,
      message_ids: rows.map((r) => r.id),
      read_at: new Date().toISOString(),
    });
  }
  return rows.length;
}
