import { Router } from 'express';
import { z } from 'zod';
import { queryOne, withTransaction, query } from '../db/pool';
import { me, requireOnboarded, requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { completeFinishedBookings } from '../services/maintenance';
import { conflict, forbidden, handler, notFound, parse } from '../utils/http';

export const reviewsRouter = Router();
reviewsRouter.use(requireOnboarded, requireRole('student'));

/**
 * Reseña de una tutoría cumplida (una por tutoría). El promedio y la cantidad de reseñas del tutor
 * se recalculan en la misma transacción, por lo que se reflejan de inmediato en las búsquedas.
 */
reviewsRouter.post(
  '/',
  handler(async (req, res) => {
    const user = me(req);
    const input = parse(
      z.object({
        booking_id: z.string().uuid(),
        rating: z.coerce.number().int().min(1).max(5),
        comment: z.string().trim().max(1000).default(''),
      }),
      req.body,
    );
    await completeFinishedBookings();
    const booking = await queryOne<{ student_id: string; tutor_id: string; status: string }>(
      'SELECT student_id, tutor_id, status FROM bookings WHERE id = $1',
      [input.booking_id],
    );
    if (!booking) throw notFound('Tutoría no encontrada.');
    if (booking.student_id !== user.id) throw forbidden('Solo puede reseñar sus propias tutorías.');
    if (booking.status !== 'completed') throw conflict('Solo se pueden reseñar tutorías cumplidas.', 'NOT_COMPLETED');

    const stats = await withTransaction(async (client) => {
      const review = await queryOne<{ id: string }>(
        `INSERT INTO reviews (booking_id, student_id, tutor_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [input.booking_id, user.id, booking.tutor_id, input.rating, input.comment],
        client,
      );
      const agg = await queryOne<{ rating_avg: number; rating_count: number }>(
        `UPDATE tutor_profiles SET
           rating_avg = (SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE tutor_id = $1),
           rating_count = (SELECT count(*) FROM reviews WHERE tutor_id = $1)
         WHERE user_id = $1 RETURNING rating_avg, rating_count`,
        [booking.tutor_id],
        client,
      );
      await audit(user.id, 'review.created', 'review', review?.id ?? null, { tutor_id: booking.tutor_id, rating: input.rating }, client);
      return { id: review?.id, ...agg };
    });
    res.status(201).json({ review: stats });
  }),
);

reviewsRouter.get(
  '/mine',
  handler(async (req, res) => {
    const reviews = await query(
      `SELECT r.id, r.booking_id, r.rating, r.comment, r.created_at, u.name AS tutor_name
         FROM reviews r JOIN users u ON u.id = r.tutor_id WHERE r.student_id = $1 ORDER BY r.created_at DESC`,
      [me(req).id],
    );
    res.json({ reviews });
  }),
);
