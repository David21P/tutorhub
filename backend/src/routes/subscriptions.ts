import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool';
import { me, requireOnboarded, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { assertSessionsBookable, buildQuote, insertBookings, loadOfferContext } from '../services/bookings';
import { SubscriptionRow, renewSubscription } from '../services/subscriptions';
import { SLOT_STEP_MIN, assertDuration, planSessions } from '../services/scheduling';
import { notifyChanged } from '../sockets/io';
import { MODALITIES } from '../types';
import { HttpError, badRequest, conflict, forbidden, handler, notFound, paramId, parse } from '../utils/http';

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireOnboarded);

const planSchema = z
  .object({
    offer_id: z.string().uuid(),
    modality: z.enum(MODALITIES as [string, ...string[]]),
    plan: z.enum(['monthly', 'block']),
    weeks: z.coerce.number().int().optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    start_min: z.coerce.number().int().min(0).max(1410),
    duration_min: z.coerce.number().int(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    auto_renew: z.boolean().default(false),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    address: z.string().trim().max(300).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.start_min % SLOT_STEP_MIN !== 0) ctx.addIssue({ code: 'custom', path: ['start_min'], message: 'La hora debe ser múltiplo de 30 minutos' });
    if (d.plan === 'block' && ![4, 8].includes(d.weeks ?? 0)) {
      ctx.addIssue({ code: 'custom', path: ['weeks'], message: 'Los bloques son de 4 u 8 semanas' });
    }
  });

type PlanInput = z.infer<typeof planSchema>;

async function prepare(userId: string, user: { lat: number | null; lng: number | null; address: string | null }, input: PlanInput) {
  assertDuration(input.duration_min);
  const weeks = input.plan === 'monthly' ? 4 : (input.weeks as number);
  const weekdays = [...new Set(input.weekdays)].sort();
  const sessions = planSessions({
    startDate: input.start_date,
    weekdays,
    startMin: input.start_min,
    durationMin: input.duration_min,
    weeks,
  });
  if (sessions.length === 0) throw badRequest('Con esos días no se genera ninguna sesión.');
  const ctx = await loadOfferContext(input.offer_id);
  if (ctx.tutor.id === userId) throw badRequest('No puede suscribirse a su propia oferta.');
  const hasOwn = input.lat !== undefined && input.lng !== undefined;
  const student = hasOwn
    ? { lat: input.lat as number, lng: input.lng as number, address: input.address ?? null }
    : { lat: user.lat, lng: user.lng, address: input.address ?? user.address };
  const quote = await buildQuote(ctx, input.modality as never, input.duration_min, student);
  return { weeks, weekdays, sessions, ctx, student, quote };
}

/** Vista previa: fechas generadas, precio total y si hay problemas de disponibilidad o traslape (sin guardar). */
subscriptionsRouter.post(
  '/preview',
  requireRole('student'),
  handler(async (req, res) => {
    const user = me(req);
    const input = parse(planSchema, req.body);
    const p = await prepare(user.id, user, input);
    let issue: { code: string; message: string; details?: unknown } | null = null;
    try {
      await assertSessionsBookable(p.sessions, p.ctx.tutor.id, user.id);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      issue = { code: err.code, message: err.message, details: err.details };
    }
    res.json({
      weeks: p.weeks,
      sessions: p.sessions.map((s) => ({ starts_at: s.start.toISO(), ends_at: s.end.toISO() })),
      per_session: p.quote.breakdown,
      route: p.quote.route,
      total_amount: Math.round(p.quote.breakdown.total_amount * p.sessions.length * 100) / 100,
      ok: issue === null,
      issue,
    });
  }),
);

/** Crea la suscripción con todas sus sesiones. Si una sola sesión no es viable, no se crea ninguna. */
subscriptionsRouter.post(
  '/',
  requireRole('student'),
  handler(async (req, res) => {
    const user = me(req);
    const input = parse(planSchema, req.body);
    const p = await prepare(user.id, user, input);
    const result = await withTransaction(async (client) => {
      await assertSessionsBookable(p.sessions, p.ctx.tutor.id, user.id, client);
      const sub = await queryOne<{ id: string }>(
        `INSERT INTO subscriptions (student_id, tutor_id, offer_id, modality, plan, weeks, auto_renew, weekdays,
                                    start_min, duration_min, start_date, student_address, student_lat, student_lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          user.id, p.ctx.tutor.id, input.offer_id, input.modality, input.plan, p.weeks,
          input.plan === 'monthly' && input.auto_renew, p.weekdays, input.start_min, input.duration_min,
          input.start_date, p.student.address, p.student.lat, p.student.lng,
        ],
        client,
      );
      const rows = await insertBookings(client, {
        subscriptionId: sub?.id ?? null,
        ctx: p.ctx,
        studentId: user.id,
        modality: input.modality as never,
        sessions: p.sessions,
        quote: p.quote,
        status: 'pending',
        student: p.student,
        notes: null,
      });
      await audit(user.id, 'subscription.requested', 'subscription', sub?.id ?? null, { sessions: rows.length }, client);
      return { id: sub?.id, sessions: rows.length };
    });
    notifyChanged(p.ctx.tutor.id, user.id);
    res.status(201).json({
      subscription: result,
      total_amount: Math.round(p.quote.breakdown.total_amount * result.sessions * 100) / 100,
    });
  }),
);

const SUB_SELECT = `
  SELECT s.id, s.student_id, su.name AS student_name, s.tutor_id, tu.name AS tutor_name, s.offer_id, o.title AS offer_title,
         s.modality, s.plan, s.weeks, s.auto_renew, s.weekdays, s.start_min, s.duration_min, s.start_date, s.status, s.created_at,
         (SELECT count(*) FROM bookings b WHERE b.subscription_id = s.id AND b.status IN ('pending','approved','completed'))::int AS sessions,
         (SELECT count(*) FROM bookings b WHERE b.subscription_id = s.id AND b.status IN ('pending','approved') AND b.ends_at > now())::int AS upcoming,
         (SELECT COALESCE(sum(b.total_amount), 0) FROM bookings b WHERE b.subscription_id = s.id AND b.status IN ('pending','approved','completed')) AS total_amount
    FROM subscriptions s
    JOIN offers o ON o.id = s.offer_id
    JOIN users su ON su.id = s.student_id
    JOIN users tu ON tu.id = s.tutor_id`;

subscriptionsRouter.get(
  '/',
  requireRole('student', 'tutor'),
  handler(async (req, res) => {
    const subscriptions = await query(
      `${SUB_SELECT} WHERE s.student_id = $1 OR s.tutor_id = $1 ORDER BY s.created_at DESC`,
      [me(req).id],
    );
    res.json({ subscriptions });
  }),
);

async function loadSub(id: string, userId: string): Promise<SubscriptionRow> {
  const sub = await queryOne<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE id = $1 AND (student_id = $2 OR tutor_id = $2)',
    [id, userId],
  );
  if (!sub) throw notFound('Suscripción no encontrada.');
  return sub;
}

async function decide(id: string, userId: string, approve: boolean): Promise<void> {
  const sub = await loadSub(id, userId);
  if (sub.tutor_id !== userId) throw forbidden('Solo el tutor puede responder la suscripción.');
  if (sub.status !== 'pending') throw conflict('La suscripción ya fue respondida.', 'ALREADY_DECIDED');
  await withTransaction(async (client) => {
    await query('UPDATE subscriptions SET status = $2 WHERE id = $1', [id, approve ? 'active' : 'rejected'], client);
    await query(
      "UPDATE bookings SET status = $2 WHERE subscription_id = $1 AND status = 'pending'",
      [id, approve ? 'approved' : 'rejected'],
      client,
    );
    await audit(userId, approve ? 'subscription.approved' : 'subscription.rejected', 'subscription', id, {}, client);
  });
  notifyChanged(sub.tutor_id, sub.student_id);
}

subscriptionsRouter.post(
  '/:id/approve',
  requireRole('tutor'),
  handler(async (req, res) => {
    await decide(paramId(req), me(req).id, true);
    res.json({ ok: true });
  }),
);

subscriptionsRouter.post(
  '/:id/reject',
  requireRole('tutor'),
  handler(async (req, res) => {
    await decide(paramId(req), me(req).id, false);
    res.json({ ok: true });
  }),
);

/** Cancela la suscripción y todas sus sesiones futuras. */
subscriptionsRouter.post(
  '/:id/cancel',
  requireRole('student', 'tutor'),
  handler(async (req, res) => {
    const user = me(req);
    const sub = await loadSub(paramId(req), user.id);
    if (!['pending', 'active'].includes(sub.status)) throw conflict('La suscripción ya no está vigente.', 'NOT_CANCELLABLE');
    await withTransaction(async (client) => {
      await query("UPDATE subscriptions SET status = 'cancelled', auto_renew = false WHERE id = $1", [sub.id], client);
      await query(
        `UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancel_reason = 'Suscripción cancelada'
          WHERE subscription_id = $1 AND status IN ('pending','approved') AND starts_at > now()`,
        [sub.id, user.id],
        client,
      );
      await audit(user.id, 'subscription.cancelled', 'subscription', sub.id, {}, client);
    });
    notifyChanged(sub.tutor_id, sub.student_id);
    res.json({ ok: true });
  }),
);

/** Activa o desactiva la renovación automática (solo planes mensuales). */
subscriptionsRouter.patch(
  '/:id',
  requireRole('student'),
  handler(async (req, res) => {
    const user = me(req);
    const { auto_renew } = parse(z.object({ auto_renew: z.boolean() }), req.body);
    const sub = await loadSub(paramId(req), user.id);
    if (sub.student_id !== user.id) throw forbidden('Solo el estudiante puede modificar su suscripción.');
    if (sub.plan !== 'monthly') throw badRequest('La renovación automática aplica solo a planes mensuales.');
    if (!['pending', 'active'].includes(sub.status)) throw conflict('La suscripción ya no está vigente.', 'NOT_CANCELLABLE');
    await query('UPDATE subscriptions SET auto_renew = $2 WHERE id = $1', [sub.id, auto_renew]);
    res.json({ ok: true, auto_renew });
  }),
);

/** Renovación manual: agrega otro bloque de sesiones a continuación de la última. */
subscriptionsRouter.post(
  '/:id/renew',
  requireRole('student'),
  handler(async (req, res) => {
    const user = me(req);
    const sub = await loadSub(paramId(req), user.id);
    if (sub.student_id !== user.id) throw forbidden('Solo el estudiante puede renovar su suscripción.');
    const added = await withTransaction((client) => renewSubscription(sub.id, { skipUnavailable: false }, client));
    await audit(user.id, 'subscription.renewed', 'subscription', sub.id, { added });
    notifyChanged(sub.tutor_id, sub.student_id);
    res.json({ ok: true, added });
  }),
);

subscriptionsRouter.get(
  '/:id/bookings',
  handler(async (req, res) => {
    const sub = await loadSub(paramId(req), me(req).id);
    const bookings = await query(
      'SELECT id, starts_at, ends_at, status, total_amount FROM bookings WHERE subscription_id = $1 ORDER BY starts_at',
      [sub.id],
    );
    res.json({ bookings });
  }),
);
