import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { me, requireOnboarded, requireRole } from '../middleware/auth';
import { SLOT_STEP_MIN } from '../services/scheduling';
import { badRequest, handler, parse } from '../utils/http';

export const availabilityRouter = Router();
availabilityRouter.use(requireOnboarded, requireRole('tutor'));

const blockSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    start_min: z.number().int().min(0).max(1410),
    end_min: z.number().int().min(30).max(1440),
  })
  .refine((b) => b.start_min % SLOT_STEP_MIN === 0 && b.end_min % SLOT_STEP_MIN === 0, 'Los bloques deben ser múltiplos de 30 minutos')
  .refine((b) => b.end_min > b.start_min, 'La hora final debe ser posterior a la inicial');

availabilityRouter.get(
  '/mine',
  handler(async (req, res) => {
    const blocks = await query(
      'SELECT weekday, start_min, end_min FROM availability WHERE tutor_id = $1 ORDER BY weekday, start_min',
      [me(req).id],
    );
    res.json({ blocks });
  }),
);

/** Reemplaza toda la cuadrícula semanal. Los bloques contiguos se unen; los traslapados se rechazan. */
availabilityRouter.put(
  '/mine',
  handler(async (req, res) => {
    const user = me(req);
    const { blocks } = parse(z.object({ blocks: z.array(blockSchema).max(200) }), req.body);
    const sorted = [...blocks].sort((a, b) => a.weekday - b.weekday || a.start_min - b.start_min);
    const merged: typeof sorted = [];
    for (const block of sorted) {
      const last = merged[merged.length - 1];
      if (last && last.weekday === block.weekday) {
        if (block.start_min < last.end_min) throw badRequest('Los bloques de disponibilidad no pueden traslaparse.');
        if (block.start_min === last.end_min) {
          last.end_min = block.end_min;
          continue;
        }
      }
      merged.push({ ...block });
    }
    await withTransaction(async (client) => {
      await query('DELETE FROM availability WHERE tutor_id = $1', [user.id], client);
      for (const b of merged) {
        await query(
          'INSERT INTO availability (tutor_id, weekday, start_min, end_min) VALUES ($1,$2,$3,$4)',
          [user.id, b.weekday, b.start_min, b.end_min],
          client,
        );
      }
    });
    res.json({ blocks: merged });
  }),
);
