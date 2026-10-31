import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { query, queryOne, withTransaction } from '../db/pool';
import { me, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { cancelOnSuspension, notifySuspension } from '../services/suspension';
import { badRequest, conflict, handler, notFound, paramId, parse } from '../utils/http';

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

// ---------- Categorías y subcategorías ----------

const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  parent_id: z.coerce.number().int().nullish(),
});

adminRouter.post(
  '/categories',
  handler(async (req, res) => {
    const input = parse(categorySchema, req.body);
    if (input.parent_id) {
      const parent = await queryOne('SELECT id, parent_id FROM categories WHERE id = $1', [input.parent_id]);
      if (!parent) throw badRequest('La categoría padre no existe.');
      if ((parent as { parent_id: number | null }).parent_id) throw badRequest('Solo se permiten dos niveles: categoría y subcategoría.');
    }
    const category = await queryOne(
      'INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id, name, parent_id, active',
      [input.name, input.parent_id ?? null],
    );
    await audit(me(req).id, 'category.created', 'category', String((category as { id: number }).id), { name: input.name });
    res.status(201).json({ category });
  }),
);

adminRouter.put(
  '/categories/:id',
  handler(async (req, res) => {
    const id = parse(z.coerce.number().int(), req.params.id);
    const input = parse(z.object({ name: z.string().trim().min(2).max(80), active: z.boolean().default(true) }), req.body);
    const category = await queryOne(
      `UPDATE categories SET name = $2, active = $3 WHERE id = $1 RETURNING id, name, parent_id, active`,
      [id, input.name, input.active],
    );
    if (!category) throw notFound('Categoría no encontrada.');
    if (!input.active) await query('UPDATE categories SET active = false WHERE parent_id = $1', [id]);
    await audit(me(req).id, 'category.updated', 'category', String(id), input);
    res.json({ category });
  }),
);

/** Elimina la categoría si nadie la usa; si tiene ofertas asociadas se desactiva en su lugar. */
adminRouter.delete(
  '/categories/:id',
  handler(async (req, res) => {
    const id = parse(z.coerce.number().int(), req.params.id);
    const used = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM offers WHERE category_id = $1 OR category_id IN (SELECT id FROM categories WHERE parent_id = $1)`,
      [id],
    );
    if ((used?.n ?? 0) > 0) {
      await query('UPDATE categories SET active = false WHERE id = $1 OR parent_id = $1', [id]);
      await audit(me(req).id, 'category.deactivated', 'category', String(id));
      res.json({ deleted: false, deactivated: true });
      return;
    }
    const removed = await queryOne('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);
    if (!removed) throw notFound('Categoría no encontrada.');
    await audit(me(req).id, 'category.deleted', 'category', String(id));
    res.json({ deleted: true, deactivated: false });
  }),
);

// ---------- Aprobación de tutores ----------

adminRouter.get(
  '/tutors',
  handler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }), req.query);
    const tutors = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.status, tp.bio, tp.hourly_rate, tp.cv_file_id, tp.portfolio_url,
              tp.approval_status, tp.approval_note, tp.rating_avg, tp.rating_count, u.created_at
         FROM tutor_profiles tp JOIN users u ON u.id = tp.user_id
        WHERE ($1::text IS NULL OR tp.approval_status = $1)
        ORDER BY (tp.approval_status = 'pending') DESC, u.created_at DESC`,
      [status ?? null],
    );
    res.json({ tutors });
  }),
);

adminRouter.post(
  '/tutors/:id/approval',
  handler(async (req, res) => {
    const id = paramId(req);
    const input = parse(
      z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() }),
      req.body,
    );
    const updated = await queryOne(
      `UPDATE tutor_profiles SET approval_status = $2, approval_note = $3,
              approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END
        WHERE user_id = $1 RETURNING user_id`,
      [id, input.status, input.note ?? null],
    );
    if (!updated) throw notFound('Tutor no encontrado.');
    await audit(me(req).id, `tutor.${input.status}`, 'user', id, { note: input.note ?? null });
    res.json({ ok: true });
  }),
);

// ---------- Usuarios y suspensiones ----------

adminRouter.get(
  '/users',
  handler(async (req, res) => {
    const f = parse(
      z.object({
        status: z.enum(['active', 'suspended']).optional(),
        role: z.enum(['student', 'tutor']).optional(),
        q: z.string().trim().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      }),
      req.query,
    );
    const users = await query(
      `SELECT id, name, email, role, status, suspended_reason, suspended_at, created_at FROM users
        WHERE role IN ('student','tutor')
          AND ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR role = $2)
          AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR email ILIKE '%' || $3 || '%')
        ORDER BY created_at DESC LIMIT $4`,
      [f.status ?? null, f.role ?? null, f.q ?? null, f.limit],
    );
    res.json({ users });
  }),
);

async function suspendUser(adminId: string, userId: string, reason: string): Promise<void> {
  const target = await queryOne<{ id: string; name: string; role: string; status: string }>(
    'SELECT id, name, role, status FROM users WHERE id = $1',
    [userId],
  );
  if (!target) throw notFound('Usuario no encontrado.');
  if (target.role === 'admin') throw badRequest('No se puede suspender a un administrador.');
  if (target.status === 'suspended') throw conflict('La cuenta ya está suspendida.', 'ALREADY_SUSPENDED');
  const notices = await withTransaction(async (client) => {
    await query("UPDATE users SET status = 'suspended', suspended_reason = $2, suspended_at = now() WHERE id = $1", [userId, reason], client);
    await audit(adminId, 'user.suspended', 'user', userId, { reason }, client);
    return cancelOnSuspension(adminId, target, client);
  });
  notifySuspension(notices);
}

async function reactivateUser(adminId: string, userId: string, via: string): Promise<void> {
  await withTransaction(async (client) => {
    await query("UPDATE users SET status = 'active', suspended_reason = NULL, suspended_at = NULL WHERE id = $1", [userId], client);
    await audit(adminId, 'user.reactivated', 'user', userId, { via }, client);
  });
}

adminRouter.post(
  '/users/:id/suspend',
  handler(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(10, 'Indique el motivo (mínimo 10 caracteres)').max(500) }), req.body);
    await suspendUser(me(req).id, paramId(req), reason);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/users/:id/reactivate',
  handler(async (req, res) => {
    const id = paramId(req);
    const target = await queryOne('SELECT id FROM users WHERE id = $1', [id]);
    if (!target) throw notFound('Usuario no encontrado.');
    await reactivateUser(me(req).id, id, 'manual');
    res.json({ ok: true });
  }),
);

// ---------- Bandeja de reportes ----------

adminRouter.get(
  '/reports',
  handler(async (req, res) => {
    const { view } = parse(z.object({ view: z.enum(['open', 'history']).default('open') }), req.query);
    const reports = await query(
      `SELECT r.id, r.reason, r.description, r.status, r.resolution_note, r.created_at, r.resolved_at, r.booking_id,
              rp.id AS reporter_id, rp.name AS reporter_name, rd.id AS reported_id, rd.name AS reported_name,
              rd.status AS reported_status, rd.role AS reported_role,
              (SELECT count(*)::int FROM reports x WHERE x.reported_id = r.reported_id) AS reported_total_reports
         FROM reports r
         JOIN users rp ON rp.id = r.reporter_id
         JOIN users rd ON rd.id = r.reported_id
        WHERE ($1 = 'open' AND r.status = 'open') OR ($1 = 'history' AND r.status <> 'open')
        ORDER BY r.created_at DESC`,
      [view],
    );
    res.json({ reports });
  }),
);

adminRouter.post(
  '/reports/:id/resolve',
  handler(async (req, res) => {
    const admin = me(req);
    const id = paramId(req);
    const input = parse(
      z.object({
        status: z.enum(['resolved', 'dismissed']),
        note: z.string().trim().min(5, 'Escriba una nota de resolución').max(1000),
        suspend_reason: z.string().trim().min(10).max(500).optional(),
      }),
      req.body,
    );
    const report = await queryOne<{ reported_id: string; status: string }>('SELECT reported_id, status FROM reports WHERE id = $1', [id]);
    if (!report) throw notFound('Reporte no encontrado.');
    if (report.status !== 'open') throw conflict('El reporte ya fue resuelto.', 'ALREADY_RESOLVED');
    await query(
      'UPDATE reports SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = now() WHERE id = $1',
      [id, input.status, input.note, admin.id],
    );
    await audit(admin.id, `report.${input.status}`, 'report', id, { note: input.note });
    if (input.suspend_reason && input.status === 'resolved') {
      await suspendUser(admin.id, report.reported_id, input.suspend_reason);
    }
    res.json({ ok: true });
  }),
);

// ---------- Apelaciones ----------

adminRouter.get(
  '/appeals',
  handler(async (req, res) => {
    const { view } = parse(z.object({ view: z.enum(['pending', 'history']).default('pending') }), req.query);
    const appeals = await query(
      `SELECT a.id, a.message, a.status, a.admin_response, a.created_at, a.resolved_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email, u.status AS user_status,
              COALESCE(a.suspended_reason, u.suspended_reason) AS suspended_reason,
              COALESCE(a.suspended_at, u.suspended_at) AS suspended_at
         FROM appeals a JOIN users u ON u.id = a.user_id
        WHERE ($1 = 'pending' AND a.status = 'pending') OR ($1 = 'history' AND a.status <> 'pending')
        ORDER BY a.created_at DESC`,
      [view],
    );
    res.json({ appeals });
  }),
);

/** Aceptar una apelación reactiva la cuenta de inmediato. */
adminRouter.post(
  '/appeals/:id/resolve',
  handler(async (req, res) => {
    const admin = me(req);
    const id = paramId(req);
    const input = parse(
      z.object({ decision: z.enum(['accepted', 'rejected']), response: z.string().trim().min(5, 'Escriba una respuesta').max(1000) }),
      req.body,
    );
    const appeal = await queryOne<{ user_id: string; status: string }>('SELECT user_id, status FROM appeals WHERE id = $1', [id]);
    if (!appeal) throw notFound('Apelación no encontrada.');
    if (appeal.status !== 'pending') throw conflict('La apelación ya fue resuelta.', 'ALREADY_RESOLVED');
    await withTransaction(async (client) => {
      await query(
        'UPDATE appeals SET status = $2, admin_response = $3, resolved_by = $4, resolved_at = now() WHERE id = $1',
        [id, input.decision, input.response, admin.id],
        client,
      );
      await audit(admin.id, `appeal.${input.decision}`, 'appeal', id, { response: input.response }, client);
      if (input.decision === 'accepted') {
        await query(
          "UPDATE users SET status = 'active', suspended_reason = NULL, suspended_at = NULL WHERE id = $1",
          [appeal.user_id],
          client,
        );
        await audit(admin.id, 'user.reactivated', 'user', appeal.user_id, { via: 'appeal', appeal_id: id }, client);
      }
    });
    res.json({ ok: true });
  }),
);

// ---------- Auditoría ----------

adminRouter.get(
  '/audit',
  handler(async (req, res) => {
    const f = parse(
      z.object({
        entity: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const entries = await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.created_at, u.name AS actor_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE ($1::text IS NULL OR a.entity = $1) ORDER BY a.id DESC LIMIT $2`,
      [f.entity ?? null, f.limit],
    );
    res.json({ entries });
  }),
);

// ---------- Analítica ----------

adminRouter.get(
  '/stats',
  handler(async (req, res) => {
    const f = parse(
      z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        min_reviews: z.coerce.number().int().min(0).default(1),
        top: z.coerce.number().int().min(1).max(20).default(5),
      }),
      req.query,
    );
    const from = f.from ?? null;
    const to = f.to ?? null;
    const tz = config.timezone;

    const ranking = (order: 'DESC' | 'ASC') =>
      query(
        `SELECT u.id, u.name, tp.rating_avg, tp.rating_count
           FROM tutor_profiles tp JOIN users u ON u.id = tp.user_id
          WHERE tp.rating_count >= GREATEST($1, 1)
          ORDER BY tp.rating_avg ${order}, tp.rating_count DESC, u.name LIMIT $2`,
        [f.min_reviews, f.top],
      );
    const [best, worst] = await Promise.all([ranking('DESC'), ranking('ASC')]);

    const hoursByCategory = await query(
      `SELECT c.id, c.name, p.name AS parent_name, round(sum(b.hours)::numeric, 2) AS hours, count(*)::int AS sessions
         FROM bookings b
         JOIN offers o ON o.id = b.offer_id
         JOIN categories c ON c.id = o.category_id
         LEFT JOIN categories p ON p.id = c.parent_id
        WHERE b.status IN ('approved', 'completed')
          AND ($1::date IS NULL OR (b.starts_at AT TIME ZONE $3)::date >= $1)
          AND ($2::date IS NULL OR (b.starts_at AT TIME ZONE $3)::date <= $2)
        GROUP BY c.id, c.name, p.name ORDER BY hours DESC`,
      [from, to, tz],
    );

    const sessionsByMonth = await query(
      `SELECT to_char(date_trunc('month', b.starts_at AT TIME ZONE $3), 'YYYY-MM') AS month,
              count(*) FILTER (WHERE b.status = 'completed')::int AS taught,
              count(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled
         FROM bookings b
        WHERE ($1::date IS NULL OR (b.starts_at AT TIME ZONE $3)::date >= $1)
          AND ($2::date IS NULL OR (b.starts_at AT TIME ZONE $3)::date <= $2)
        GROUP BY 1 HAVING count(*) FILTER (WHERE b.status IN ('completed','cancelled')) > 0
        ORDER BY 1`,
      [from, to, tz],
    );

    const totals = await queryOne(
      `SELECT (SELECT count(*)::int FROM users WHERE role = 'student') AS students,
              (SELECT count(*)::int FROM users WHERE role = 'tutor') AS tutors,
              (SELECT count(*)::int FROM tutor_profiles WHERE approval_status = 'pending') AS pending_tutors,
              (SELECT count(*)::int FROM bookings WHERE status = 'completed') AS completed_sessions,
              (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports,
              (SELECT count(*)::int FROM appeals WHERE status = 'pending') AS pending_appeals,
              (SELECT count(*)::int FROM users WHERE status = 'suspended') AS suspended_users`,
    );
    res.json({ best_tutors: best, worst_tutors: worst, hours_by_category: hoursByCategory, sessions_by_month: sessionsByMonth, totals });
  }),
);
