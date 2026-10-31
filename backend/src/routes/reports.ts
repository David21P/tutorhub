import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { me, requireOnboarded, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { badRequest, handler, notFound, parse } from '../utils/http';

export const reportsRouter = Router();
reportsRouter.use(requireOnboarded, requireRole('student', 'tutor'));

/** Reporte de un usuario con el que se tuvo una tutoría. La evidencia textual es obligatoria. */
reportsRouter.post(
  '/',
  handler(async (req, res) => {
    const user = me(req);
    const input = parse(
      z.object({
        reported_id: z.string().uuid(),
        booking_id: z.string().uuid().optional(),
        reason: z.enum(['inasistencia', 'conducta_inapropiada', 'cobros_indebidos', 'otro']),
        description: z.string().trim().min(20, 'Describa la evidencia con al menos 20 caracteres').max(2000),
      }),
      req.body,
    );
    if (input.reported_id === user.id) throw badRequest('No puede reportarse a sí mismo.');
    const target = await queryOne('SELECT id FROM users WHERE id = $1 AND role IN (\'student\', \'tutor\')', [input.reported_id]);
    if (!target) throw notFound('Usuario no encontrado.');
    const related = await queryOne(
      `SELECT id FROM bookings
        WHERE ((student_id = $1 AND tutor_id = $2) OR (student_id = $2 AND tutor_id = $1))
          AND ($3::uuid IS NULL OR id = $3)
        LIMIT 1`,
      [user.id, input.reported_id, input.booking_id ?? null],
    );
    if (!related) throw badRequest('Solo puede reportar a usuarios con los que tuvo una tutoría.');
    const report = await queryOne<{ id: string }>(
      `INSERT INTO reports (reporter_id, reported_id, booking_id, reason, description)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, status, created_at`,
      [user.id, input.reported_id, input.booking_id ?? null, input.reason, input.description],
    );
    await audit(user.id, 'report.created', 'report', report?.id ?? null, { reported_id: input.reported_id, reason: input.reason });
    res.status(201).json({ report });
  }),
);

reportsRouter.get(
  '/mine',
  handler(async (req, res) => {
    const reports = await query(
      `SELECT r.id, r.reason, r.description, r.status, r.resolution_note, r.created_at, u.name AS reported_name
         FROM reports r JOIN users u ON u.id = r.reported_id WHERE r.reporter_id = $1 ORDER BY r.created_at DESC`,
      [me(req).id],
    );
    res.json({ reports });
  }),
);
