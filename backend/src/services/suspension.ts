import { PoolClient } from 'pg';
import { query } from '../db/pool';
import { emitToUser, notifyChanged } from '../sockets/io';
import { audit } from './audit';
import { MessageRow } from './chat';

export interface SystemNotice {
  message: MessageRow;
  student_id: string;
  tutor_id: string;
}

interface Affected {
  id: string;
  tutor_id: string;
  student_id: string;
}

/**
 * Al suspender una cuenta se cancelan sus tutorías próximas (pendientes o aprobadas) y sus suscripciones vigentes,
 * y se deja un aviso del sistema en el chat de cada persona afectada. Reactivar la cuenta NO restaura nada:
 * el horario pudo ser ocupado y la otra persona ya fue avisada.
 * Devuelve los avisos creados para emitirlos en tiempo real cuando la transacción se confirme.
 */
export async function cancelOnSuspension(
  adminId: string,
  user: { id: string; name: string; role: string },
  client: PoolClient,
): Promise<SystemNotice[]> {
  const reason = user.role === 'tutor' ? 'Cuenta del tutor suspendida' : 'Cuenta del estudiante suspendida';
  const subs = await query<{ id: string }>(
    `UPDATE subscriptions SET status = 'cancelled', auto_renew = false
      WHERE (tutor_id = $1 OR student_id = $1) AND status IN ('pending', 'active') RETURNING id`,
    [user.id],
    client,
  );
  const bookings = await query<Affected>(
    `UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancel_reason = $3
      WHERE (tutor_id = $1 OR student_id = $1) AND status IN ('pending', 'approved') AND starts_at > now()
      RETURNING id, tutor_id, student_id`,
    [user.id, adminId, reason],
    client,
  );

  // Un aviso por conversación (tutor-estudiante afectada), con el número de sesiones canceladas.
  const perPair = new Map<string, { tutor_id: string; student_id: string; count: number }>();
  for (const b of bookings) {
    const key = `${b.student_id}:${b.tutor_id}`;
    const entry = perPair.get(key) ?? { tutor_id: b.tutor_id, student_id: b.student_id, count: 0 };
    entry.count += 1;
    perPair.set(key, entry);
  }

  const created: SystemNotice[] = [];
  for (const pair of perPair.values()) {
    const conv = await query<{ id: string }>(
      `INSERT INTO conversations (student_id, tutor_id) VALUES ($1, $2)
       ON CONFLICT (student_id, tutor_id) DO UPDATE SET student_id = EXCLUDED.student_id RETURNING id`,
      [pair.student_id, pair.tutor_id],
      client,
    );
    const advice = user.role === 'tutor' ? ' Puede buscar otro tutor y reservar de nuevo.' : '';
    const body =
      `Aviso del sistema: la cuenta del ${user.role === 'tutor' ? 'tutor' : 'estudiante'} fue suspendida. ` +
      `Se cancelaron ${pair.count} tutoría(s) próxima(s) entre ustedes.${advice}`;
    const rows = await query<MessageRow>(
      `INSERT INTO messages (conversation_id, sender_id, body, is_system) VALUES ($1, $2, $3, true)
       RETURNING id, conversation_id, sender_id, body, created_at, read_at, is_system`,
      [conv[0]?.id, user.id, body],
      client,
    );
    if (rows[0]) {
      await query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [conv[0]?.id, rows[0].created_at], client);
      created.push({ message: rows[0], student_id: pair.student_id, tutor_id: pair.tutor_id });
    }
  }

  await audit(
    adminId,
    'user.suspension_cancellations',
    'user',
    user.id,
    { bookings: bookings.length, subscriptions: subs.length },
    client,
  );
  return created;
}

/** Entrega en tiempo real los avisos creados al suspender (se llama después de confirmar la transacción). */
export function notifySuspension(notices: SystemNotice[]): void {
  for (const n of notices) {
    emitToUser(n.student_id, 'message:new', n.message);
    emitToUser(n.tutor_id, 'message:new', n.message);
    notifyChanged(n.student_id, n.tutor_id);
  }
}
