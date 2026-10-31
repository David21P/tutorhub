import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { me, requireOnboarded, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { MODALITIES } from '../types';
import { badRequest, forbidden, handler, notFound, paramId, parse } from '../utils/http';

export const offersRouter = Router();
offersRouter.use(requireOnboarded, requireRole('tutor'));

const offerSchema = z.object({
  category_id: z.coerce.number().int(),
  title: z.string().trim().min(5, 'El título debe tener al menos 5 caracteres').max(120),
  description: z.string().trim().max(2000).default(''),
  modalities: z.array(z.enum(MODALITIES as [string, ...string[]])).min(1, 'Seleccione al menos una modalidad'),
  hourly_rate: z.coerce.number().min(0).max(100000),
  km_rate: z.coerce.number().min(0).max(1000).default(0),
});

async function assertCanPublish(tutorId: string): Promise<void> {
  const p = await queryOne<{ approval_status: string }>('SELECT approval_status FROM tutor_profiles WHERE user_id = $1', [tutorId]);
  if (p?.approval_status !== 'approved') {
    throw forbidden('Su perfil debe ser aprobado por un administrador antes de publicar ofertas.', 'TUTOR_NOT_APPROVED');
  }
}

async function assertCategory(id: number): Promise<void> {
  const c = await queryOne('SELECT id FROM categories WHERE id = $1 AND active', [id]);
  if (!c) throw badRequest('La categoría seleccionada no existe.');
}

offersRouter.get(
  '/mine',
  handler(async (req, res) => {
    const offers = await query(
      `SELECT o.*, c.name AS category_name FROM offers o JOIN categories c ON c.id = o.category_id
        WHERE o.tutor_id = $1 ORDER BY o.created_at DESC`,
      [me(req).id],
    );
    res.json({ offers });
  }),
);

offersRouter.post(
  '/',
  handler(async (req, res) => {
    const user = me(req);
    await assertCanPublish(user.id);
    const input = parse(offerSchema, req.body);
    await assertCategory(input.category_id);
    const offer = await queryOne<{ id: string }>(
      `INSERT INTO offers (tutor_id, category_id, title, description, modalities, hourly_rate, km_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [user.id, input.category_id, input.title, input.description, input.modalities, input.hourly_rate, input.km_rate],
    );
    await audit(user.id, 'offer.created', 'offer', offer?.id ?? null, { title: input.title });
    res.status(201).json({ offer });
  }),
);

offersRouter.put(
  '/:id',
  handler(async (req, res) => {
    const user = me(req);
    const id = paramId(req);
    const input = parse(offerSchema.extend({ active: z.boolean().default(true) }), req.body);
    await assertCategory(input.category_id);
    const offer = await queryOne(
      `UPDATE offers SET category_id=$3, title=$4, description=$5, modalities=$6, hourly_rate=$7, km_rate=$8, active=$9
        WHERE id=$1 AND tutor_id=$2 RETURNING *`,
      [id, user.id, input.category_id, input.title, input.description, input.modalities, input.hourly_rate, input.km_rate, input.active],
    );
    if (!offer) throw notFound('Oferta no encontrada.');
    await audit(user.id, 'offer.updated', 'offer', id, { active: input.active });
    res.json({ offer });
  }),
);

/** Las ofertas con historial no se borran: se desactivan. */
offersRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const user = me(req);
    const id = paramId(req);
    const offer = await queryOne('UPDATE offers SET active = false WHERE id = $1 AND tutor_id = $2 RETURNING id', [id, user.id]);
    if (!offer) throw notFound('Oferta no encontrada.');
    await audit(user.id, 'offer.deactivated', 'offer', id);
    res.status(204).end();
  }),
);
