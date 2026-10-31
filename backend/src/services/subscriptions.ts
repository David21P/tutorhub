import { DateTime } from 'luxon';
import { PoolClient } from 'pg';
import { config } from '../config';
import { queryOne } from '../db/pool';
import { Modality } from '../types';
import { badRequest, notFound } from '../utils/http';
import { assertSessionsBookable, buildQuote, insertBookings, loadOfferContext } from './bookings';
import { PlannedSession, findConflicts, isWithinAvailability, planSessions } from './scheduling';

export interface SubscriptionRow {
  id: string;
  student_id: string;
  tutor_id: string;
  offer_id: string;
  modality: Modality;
  plan: 'monthly' | 'block';
  weeks: number;
  auto_renew: boolean;
  weekdays: number[];
  start_min: number;
  duration_min: number;
  start_date: string;
  status: 'pending' | 'active' | 'rejected' | 'cancelled' | 'finished';
  student_address: string | null;
  student_lat: number | null;
  student_lng: number | null;
}

/**
 * Agrega otro bloque de sesiones a una suscripción activa, empezando el día siguiente a su última sesión.
 * Con skipUnavailable (renovación automática) se omiten las fechas fuera de disponibilidad o traslapadas;
 * en la renovación manual cualquier problema se informa al usuario.
 */
export async function renewSubscription(
  subscriptionId: string,
  opts: { skipUnavailable: boolean },
  client: PoolClient,
): Promise<number> {
  const sub = await queryOne<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE',
    [subscriptionId],
    client,
  );
  if (!sub) throw notFound('Suscripción no encontrada.');
  if (sub.status !== 'active') throw badRequest('Solo se pueden renovar suscripciones activas.');

  const last = await queryOne<{ last_start: Date | null }>(
    `SELECT max(starts_at) AS last_start FROM bookings
      WHERE subscription_id = $1 AND status IN ('pending', 'approved', 'completed')`,
    [subscriptionId],
    client,
  );
  const base = last?.last_start
    ? DateTime.fromJSDate(last.last_start).setZone(config.timezone)
    : DateTime.fromISO(sub.start_date, { zone: config.timezone });
  const nextStart = base.plus({ days: 1 }).toISODate() ?? sub.start_date;

  const ctx = await loadOfferContext(sub.offer_id, client);
  const student = { lat: sub.student_lat, lng: sub.student_lng, address: sub.student_address };
  const quote = await buildQuote(ctx, sub.modality, sub.duration_min, student);

  let sessions: PlannedSession[] = planSessions({
    startDate: nextStart,
    weekdays: sub.weekdays,
    startMin: sub.start_min,
    durationMin: sub.duration_min,
    weeks: sub.weeks,
  });

  if (opts.skipUnavailable) {
    const usable: PlannedSession[] = [];
    for (const s of sessions) {
      if (await isWithinAvailability(sub.tutor_id, s, client)) usable.push(s);
    }
    const conflicts = await findConflicts(usable, sub.tutor_id, sub.student_id, client);
    const blocked = new Set(conflicts.map((c) => DateTime.fromISO(c.starts_at).toMillis()));
    sessions = usable.filter((s) => !blocked.has(s.start.toMillis()));
  } else {
    await assertSessionsBookable(sessions, sub.tutor_id, sub.student_id, client);
  }
  if (sessions.length === 0) throw badRequest('No hay fechas disponibles para renovar.');

  const rows = await insertBookings(client, {
    subscriptionId: sub.id,
    ctx,
    studentId: sub.student_id,
    modality: sub.modality,
    sessions,
    quote,
    status: 'approved',
    student,
    notes: null,
  });
  return rows.length;
}
