import { DateTime } from 'luxon';
import { config } from '../config';
import { pool, query, withTransaction } from '../db/pool';
import { SubscriptionRow, renewSubscription } from './subscriptions';

/** Las tutorías aprobadas cuyo horario ya terminó pasan a "cumplida" (habilita la reseña). */
export async function completeFinishedBookings(): Promise<number> {
  const result = await pool.query(
    "UPDATE bookings SET status = 'completed' WHERE status = 'approved' AND ends_at <= now()",
  );
  return result.rowCount ?? 0;
}

/** Una suscripción activa sin sesiones futuras pendientes de ocurrir pasa a "finalizada". */
export async function finishSubscriptions(): Promise<number> {
  const result = await pool.query(
    `UPDATE subscriptions s SET status = 'finished'
      WHERE s.status = 'active' AND NOT s.auto_renew
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.subscription_id = s.id
                         AND b.status IN ('pending', 'approved') AND b.ends_at > now())`,
  );
  return result.rowCount ?? 0;
}

/**
 * Renueva las suscripciones con renovación automática a las que les quedan menos de 7 días de sesiones.
 * Las fechas que ya no estén disponibles o que se traslapen se omiten.
 */
export async function renewDueSubscriptions(): Promise<number> {
  const due = await query<SubscriptionRow>(
    `SELECT s.* FROM subscriptions s
      WHERE s.status = 'active' AND s.auto_renew
        AND COALESCE((SELECT max(b.ends_at) FROM bookings b
                       WHERE b.subscription_id = s.id AND b.status IN ('pending', 'approved')), now())
            < now() + interval '7 days'`,
  );
  let renewed = 0;
  for (const sub of due) {
    try {
      await withTransaction((client) => renewSubscription(sub.id, { skipUnavailable: true }, client));
      renewed += 1;
    } catch (err) {
      console.warn(`No se pudo renovar la suscripción ${sub.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return renewed;
}

export async function runMaintenance(): Promise<void> {
  await completeFinishedBookings();
  await finishSubscriptions();
  await renewDueSubscriptions();
}

/** Programa el mantenimiento periódico (cada 10 minutos). */
export function startMaintenance(): NodeJS.Timeout {
  const timer = setInterval(() => {
    runMaintenance().catch((err) => console.error('Error en el mantenimiento:', err));
  }, 10 * 60 * 1000);
  timer.unref();
  return timer;
}

export const nowInZone = (): DateTime => DateTime.now().setZone(config.timezone);
