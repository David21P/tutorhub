import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { me } from '../middleware/auth';
import { audit } from '../services/audit';
import { conflict, handler, parse } from '../utils/http';

export const accountRouter = Router();

/** Disponible también para cuentas suspendidas: motivo, fecha, políticas y estado de apelaciones. */
accountRouter.get(
  '/suspension',
  handler(async (req, res) => {
    const user = me(req);
    const info = await queryOne<{ status: string; suspended_reason: string | null; suspended_at: Date | null }>(
      'SELECT status, suspended_reason, suspended_at FROM users WHERE id = $1',
      [user.id],
    );
    const appeals = await query(
      'SELECT id, message, status, admin_response, created_at, resolved_at FROM appeals WHERE user_id = $1 ORDER BY created_at DESC',
      [user.id],
    );
    res.json({
      suspended: info?.status === 'suspended',
      reason: info?.suspended_reason ?? null,
      suspended_at: info?.suspended_at ?? null,
      policies_url: '/politicas',
      appeals,
    });
  }),
);

/** Apelación del usuario suspendido. Solo puede haber una pendiente a la vez. */
accountRouter.post(
  '/appeals',
  handler(async (req, res) => {
    const user = me(req);
    const { message } = parse(z.object({ message: z.string().trim().min(20, 'Explique su caso con al menos 20 caracteres').max(2000) }), req.body);
    if (user.status !== 'suspended') throw conflict('Su cuenta no está suspendida.', 'NOT_SUSPENDED');
    const pending = await queryOne("SELECT id FROM appeals WHERE user_id = $1 AND status = 'pending'", [user.id]);
    if (pending) throw conflict('Ya tiene una apelación en revisión.', 'APPEAL_PENDING');
    const appeal = await queryOne<{ id: string }>(
      `INSERT INTO appeals (user_id, message, suspended_reason, suspended_at)
       SELECT id, $2, suspended_reason, suspended_at FROM users WHERE id = $1
       RETURNING id, status, created_at`,
      [user.id, message],
    );
    await audit(user.id, 'appeal.created', 'appeal', appeal?.id ?? null);
    res.status(201).json({ appeal });
  }),
);
