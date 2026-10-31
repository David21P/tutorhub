import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { me, requireOnboarded, requireRole } from '../middleware/auth';
import { loadConversation, markRead, sendMessage } from '../services/chat';
import { badRequest, handler, notFound, paramId, parse } from '../utils/http';

export const chatRouter = Router();
chatRouter.use(requireOnboarded, requireRole('student', 'tutor'));

/** Conversaciones del usuario con último mensaje y mensajes sin leer. */
chatRouter.get(
  '/conversations',
  handler(async (req, res) => {
    const user = me(req);
    const conversations = await query(
      `SELECT c.id, c.student_id, c.tutor_id, c.last_message_at,
              o.id AS other_id, o.name AS other_name, o.photo_url AS other_photo,
              (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
              (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL)::int AS unread
         FROM conversations c
         JOIN users o ON o.id = CASE WHEN c.student_id = $1 THEN c.tutor_id ELSE c.student_id END
        WHERE c.student_id = $1 OR c.tutor_id = $1
        ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
      [user.id],
    );
    res.json({ conversations });
  }),
);

/** Un estudiante abre (o recupera) la conversación con un tutor. */
chatRouter.post(
  '/conversations',
  requireRole('student'),
  handler(async (req, res) => {
    const user = me(req);
    const { tutor_id } = parse(z.object({ tutor_id: z.string().uuid() }), req.body);
    const tutor = await queryOne(
      `SELECT u.id FROM users u JOIN tutor_profiles tp ON tp.user_id = u.id
        WHERE u.id = $1 AND u.status = 'active' AND tp.approval_status = 'approved'`,
      [tutor_id],
    );
    if (!tutor) throw notFound('Tutor no encontrado.');
    if (tutor_id === user.id) throw badRequest('No puede chatear consigo mismo.');
    const conv = await queryOne<{ id: string }>(
      `INSERT INTO conversations (student_id, tutor_id) VALUES ($1, $2)
       ON CONFLICT (student_id, tutor_id) DO UPDATE SET student_id = EXCLUDED.student_id RETURNING id`,
      [user.id, tutor_id],
    );
    res.status(201).json({ id: conv?.id });
  }),
);

chatRouter.get(
  '/conversations/:id/messages',
  handler(async (req, res) => {
    const user = me(req);
    const id = paramId(req);
    await loadConversation(id, user.id);
    const { before, limit } = parse(
      z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }),
      req.query,
    );
    const params: unknown[] = [id, limit];
    let cursor = '';
    if (before) {
      params.push(before);
      cursor = 'AND created_at < $3';
    }
    const rows = await query(
      `SELECT id, conversation_id, sender_id, body, created_at, read_at, is_system FROM messages
        WHERE conversation_id = $1 ${cursor} ORDER BY created_at DESC LIMIT $2`,
      params,
    );
    res.json({ messages: rows.reverse() });
  }),
);

/** Alternativa HTTP al evento de socket (también notifica en tiempo real). */
chatRouter.post(
  '/conversations/:id/messages',
  handler(async (req, res) => {
    const { body } = parse(z.object({ body: z.string() }), req.body);
    res.status(201).json({ message: await sendMessage(paramId(req), me(req).id, body) });
  }),
);

chatRouter.post(
  '/conversations/:id/read',
  handler(async (req, res) => {
    res.json({ updated: await markRead(paramId(req), me(req).id) });
  }),
);
