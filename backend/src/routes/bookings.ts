import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool';
import { me, requireOnboarded, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { assertSessionsBookable, buildQuote, insertBookings, loadOfferContext } from '../services/bookings';
import { completeFinishedBookings } from '../services/maintenance';
import { assertDuration, parseInstant } from '../services/scheduling';
import { notifyChanged } from '../sockets/io';
import { MODALITIES } from '../types';
import { badRequest, conflict, forbidden, handler, notFound, paramId, parse } from '../utils/http';

export const bookingsRouter = Router();
bookingsRouter.use(requireOnboarded);

export const BOOKING_SELECT = `
  SELECT b.id, b.subscription_id, b.offer_id, o.title AS offer_title, c.name AS category_name,
         b.tutor_id, tu.name AS tutor_name, b.student_id, su.name AS student_name,
         b.starts_at, b.ends_at, b.modality, b.status, b.hours, b.hourly_rate, b.base_amount,
         b.distance_km, b.km_rate, b.travel_amount, b.total_amount,
         b.student_address, b.student_lat, b.student_lng, b.notes, b.cancel_reason, b.created_at,
         tu.address AS tutor_address, tu.lat AS tutor_lat, tu.lng AS tutor_lng,
         (r.id IS NOT NULL) AS reviewed,
         CASE WHEN b.status IN ('approved', 'completed')
              THEN CASE WHEN b.tutor_id = $1 THEN su.phone ELSE tu.phone END END AS counterpart_phone
    FROM bookings b
    JOIN offers o ON o.id = b.offer_id
    JOIN categories c ON c.id = o.category_id
    JOIN users tu ON tu.id = b.tutor_id
    JOIN users su ON su.id = b.student_id
    LEFT JOIN reviews r ON r.booking_id = b.id`;

const locationFields = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().trim().max(300).optional(),
};

const quoteSchema = z.object({
  offer_id: z.string().uuid(),
  modality: z.enum(MODALITIES as [string, ...string[]]),
  minutes: z.coerce.number().int(),
  ...locationFields,
});

function studentLocation(user: { lat: number | null; lng: number | null; address: string | null }, input: z.infer<z.ZodObject<typeof locationFields>>) {
  const hasOwn = input.lat !== undefined && input.lng !== undefined;
  return hasOwn
    ? { lat: input.lat as number, lng: input.lng as number, address: input.address ?? null }
    : { lat: user.lat, lng: user.lng, address: input.address ?? user.address };
}

/** Presupuesto: desglose de tarifa base + traslado por km, con la ruta real tutor → estudiante. */
bookingsRouter.post(
  '/quote',
  requireRole('student'),
  handler(async (req, res) => {
    const user = me(req);
    const input = parse(quoteSchema, req.body);
    const ctx = await loadOfferContext(input.offer_id);
    const quote = await buildQuote(ctx, input.modality as never, input.minutes, studentLocation(user, input));
    res.json({ quote });
  }),
);

/** Solicitud de una tutoría puntual. Queda pendiente hasta que el tutor la apruebe. */
bookingsRouter.post(
  '/',
  requireRole('student'),
  handler(async (req, res) => {
    const user = me(req);
    const input = parse(
      quoteSchema.extend({ starts_at: z.string().min(10), notes: z.string().trim().max(500).optional() }),
      req.body,
    );
    assertDuration(input.minutes);
    const start = parseInstant(input.starts_at);
    const sessions = [{ start, end: start.plus({ minutes: input.minutes }) }];
    const ctx = await loadOfferContext(input.offer_id);
    if (ctx.tutor.id === user.id) throw badRequest('No puede reservar su propia oferta.');
    const student = studentLocation(user, input);
    const quote = await buildQuote(ctx, input.modality as never, input.minutes, student);

    const rows = await withTransaction(async (client) => {
      await assertSessionsBookable(sessions, ctx.tutor.id, user.id, client);
      const inserted = await insertBookings(client, {
        subscriptionId: null,
        ctx,
        studentId: user.id,
        modality: input.modality as never,
        sessions,
        quote,
        status: 'pending',
        student,
        notes: input.notes ?? null,
      });
      await audit(user.id, 'booking.requested', 'booking', inserted[0]?.id ?? null, { offer_id: input.offer_id }, client);
      return inserted;
    });
    notifyChanged(ctx.tutor.id, user.id);
    res.status(201).json({ booking: rows[0], quote });
  }),
);

const listSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
});

/** Tutorías del usuario (como estudiante o como tutor). Admite un rango de fechas para el calendario. */
bookingsRouter.get(
  '/',
  requireRole('student', 'tutor'),
  handler(async (req, res) => {
    const user = me(req);
    const f = parse(listSchema, req.query);
    await completeFinishedBookings();
    const params: unknown[] = [user.id];
    const where = ['(b.student_id = $1 OR b.tutor_id = $1)'];
    if (f.from) {
      params.push(parseInstant(f.from).toUTC().toISO());
      where.push(`b.ends_at >= $${params.length}`);
    }
    if (f.to) {
      params.push(parseInstant(f.to).toUTC().toISO());
      where.push(`b.starts_at < $${params.length}`);
    }
    if (f.status) {
      params.push(f.status);
      where.push(`b.status = $${params.length}`);
    }
    const bookings = await query(`${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.starts_at`, params);
    res.json({ bookings });
  }),
);

bookingsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const user = me(req);
    const booking = await queryOne(`${BOOKING_SELECT} WHERE b.id = $2 AND (b.student_id = $1 OR b.tutor_id = $1)`, [
      user.id,
      paramId(req),
    ]);
    if (!booking) throw notFound('Tutoría no encontrada.');
    res.json({ booking });
  }),
);

interface BookingLite {
  id: string;
  tutor_id: string;
  student_id: string;
  subscription_id: string | null;
  status: string;
  starts_at: Date;
}

async function loadOwn(id: string, userId: string): Promise<BookingLite> {
  const b = await queryOne<BookingLite>(
    'SELECT id, tutor_id, student_id, subscription_id, status, starts_at FROM bookings WHERE id = $1 AND (tutor_id = $2 OR student_id = $2)',
    [id, userId],
  );
  if (!b) throw notFound('Tutoría no encontrada.');
  return b;
}

async function decide(req: Parameters<typeof me>[0], status: 'approved' | 'rejected'): Promise<void> {
  const user = me(req);
  const b = await loadOwn(paramId(req), user.id);
  if (b.tutor_id !== user.id) throw forbidden('Solo el tutor puede responder la solicitud.');
  if (b.subscription_id) throw badRequest('Esta sesión pertenece a una suscripción; responda la suscripción completa.');
  if (b.status !== 'pending') throw conflict('La solicitud ya fue respondida.', 'ALREADY_DECIDED');
  if (b.starts_at <= new Date()) throw badRequest('La tutoría ya pasó.');
  await query('UPDATE bookings SET status = $2 WHERE id = $1', [b.id, status]);
  await audit(user.id, `booking.${status}`, 'booking', b.id);
  notifyChanged(b.tutor_id, b.student_id);
}

bookingsRouter.post(
  '/:id/approve',
  requireRole('tutor'),
  handler(async (req, res) => {
    await decide(req, 'approved');
    res.json({ ok: true });
  }),
);

bookingsRouter.post(
  '/:id/reject',
  requireRole('tutor'),
  handler(async (req, res) => {
    await decide(req, 'rejected');
    res.json({ ok: true });
  }),
);

/** Cancelación por cualquiera de las dos partes, antes de que ocurra la tutoría. */
bookingsRouter.post(
  '/:id/cancel',
  requireRole('student', 'tutor'),
  handler(async (req, res) => {
    const user = me(req);
    const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body ?? {});
    const b = await loadOwn(paramId(req), user.id);
    if (!['pending', 'approved'].includes(b.status)) throw conflict('Esta tutoría ya no se puede cancelar.', 'NOT_CANCELLABLE');
    if (b.starts_at <= new Date()) throw badRequest('No se puede cancelar una tutoría que ya comenzó.');
    await query("UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancel_reason = $3 WHERE id = $1", [
      b.id,
      user.id,
      reason ?? null,
    ]);
    await audit(user.id, 'booking.cancelled', 'booking', b.id, { reason: reason ?? null });
    notifyChanged(b.tutor_id, b.student_id);
    res.json({ ok: true });
  }),
);
