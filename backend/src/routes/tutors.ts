import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { me, requireOnboarded, requireRole } from '../middleware/auth';
import { freeSlots } from '../services/scheduling';
import { handler, notFound, paramId, parse } from '../utils/http';

export const tutorsRouter = Router();
tutorsRouter.use(requireOnboarded);

const HAVERSINE = (latParam: string, lngParam: string): string =>
  `(6371 * 2 * asin(sqrt(least(1,
      power(sin(radians(u.lat - ${latParam}::float8) / 2), 2) +
      cos(radians(${latParam}::float8)) * cos(radians(u.lat)) *
      power(sin(radians(u.lng - ${lngParam}::float8) / 2), 2)))))`;

const searchSchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().positive().max(500).optional(),
  category_id: z.coerce.number().int().optional(),
  modality: z.enum(['virtual', 'presencial', 'tutor_home', 'student_home']).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  min_rating: z.coerce.number().min(0).max(5).optional(),
  min_reviews: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['distance', 'rating', 'price_asc', 'price_desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Motor de búsqueda geoespacial. Filtros: radio de cercanía (Haversine sobre la ubicación del estudiante),
 * calificación promedio y cantidad de reseñas, rango de precios, categoría (incluye subcategorías) y modalidad.
 * Si se indica un radio, solo se consideran ofertas con modalidad presencial (la cercanía no aplica a clases virtuales).
 */
tutorsRouter.get(
  '/search',
  requireRole('student', 'admin'),
  handler(async (req, res) => {
    const f = parse(searchSchema, req.query);
    const params: unknown[] = [];
    const add = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const hasLocation = f.lat !== undefined && f.lng !== undefined;
    const latP = add(hasLocation ? f.lat : null);
    const lngP = add(hasLocation ? f.lng : null);
    const distanceExpr = `CASE WHEN ${latP}::float8 IS NOT NULL AND u.lat IS NOT NULL THEN ${HAVERSINE(latP, lngP)} END`;

    const where: string[] = [
      'o.active',
      "u.status = 'active'",
      "tp.approval_status = 'approved'",
      'c.active',
    ];
    if (f.category_id !== undefined) {
      const p = add(f.category_id);
      where.push(`o.category_id IN (SELECT id FROM categories WHERE id = ${p} OR parent_id = ${p})`);
    }
    if (f.modality === 'virtual') where.push("'virtual' = ANY(o.modalities)");
    else if (f.modality === 'presencial') where.push("o.modalities && ARRAY['tutor_home','student_home']::text[]");
    else if (f.modality) where.push(`${add(f.modality)} = ANY(o.modalities)`);
    if (f.min_price !== undefined) where.push(`o.hourly_rate >= ${add(f.min_price)}`);
    if (f.max_price !== undefined) where.push(`o.hourly_rate <= ${add(f.max_price)}`);
    if (f.min_rating !== undefined) where.push(`tp.rating_avg >= ${add(f.min_rating)}`);
    if (f.min_reviews !== undefined) where.push(`tp.rating_count >= ${add(f.min_reviews)}`);
    if (f.q) {
      const p = add(`%${f.q}%`);
      where.push(`(o.title ILIKE ${p} OR u.name ILIKE ${p} OR c.name ILIKE ${p})`);
    }

    const outer: string[] = [];
    if (f.radius_km !== undefined) {
      if (!hasLocation) {
        res.status(400).json({ error: 'bad_request', code: 'BAD_REQUEST', message: 'Para filtrar por radio indique su ubicación.' });
        return;
      }
      outer.push(
        `(t.modalities && ARRAY['tutor_home','student_home']::text[] AND t.distance_km IS NOT NULL AND t.distance_km <= ${add(f.radius_km)})`,
      );
    }

    const defaultSort = hasLocation ? 'distance' : 'rating';
    const order = {
      distance: 'distance_km ASC NULLS LAST, rating_avg DESC',
      rating: 'rating_avg DESC, rating_count DESC',
      price_asc: 'min_rate ASC',
      price_desc: 'min_rate DESC',
    }[f.sort ?? defaultSort];

    const rows = await query(
      `SELECT t.tutor_id, t.tutor_name, t.photo_url, t.address, t.lat, t.lng, t.bio, t.rating_avg, t.rating_count,
              t.distance_km, min(t.hourly_rate) AS min_rate,
              json_agg(json_build_object(
                'id', t.offer_id, 'title', t.title, 'category_id', t.category_id, 'category_name', t.category_name,
                'modalities', t.modalities, 'hourly_rate', t.hourly_rate, 'km_rate', t.km_rate
              ) ORDER BY t.hourly_rate) AS offers
         FROM (
           SELECT o.id AS offer_id, o.title, o.modalities, o.hourly_rate, o.km_rate, o.category_id, c.name AS category_name,
                  u.id AS tutor_id, u.name AS tutor_name, u.photo_url, u.address, u.lat, u.lng,
                  tp.bio, tp.rating_avg, tp.rating_count, ${distanceExpr} AS distance_km
             FROM offers o
             JOIN users u ON u.id = o.tutor_id
             JOIN tutor_profiles tp ON tp.user_id = u.id
             JOIN categories c ON c.id = o.category_id
            WHERE ${where.join(' AND ')}
         ) t
        ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}
        GROUP BY t.tutor_id, t.tutor_name, t.photo_url, t.address, t.lat, t.lng, t.bio, t.rating_avg, t.rating_count, t.distance_km
        ORDER BY ${order}
        LIMIT ${add(f.limit)} OFFSET ${add(f.offset)}`,
      params,
    );
    res.json({ tutors: rows });
  }),
);

/** Perfil público de un tutor: oferta, disponibilidad semanal y últimas reseñas. */
tutorsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const viewer = me(req);
    const id = paramId(req);
    const tutor = await queryOne<Record<string, unknown>>(
      `SELECT u.id, u.name, u.photo_url, u.address, u.lat, u.lng, u.status,
              tp.bio, tp.hourly_rate, tp.portfolio_url, tp.cv_file_id, tp.approval_status, tp.rating_avg, tp.rating_count
         FROM users u JOIN tutor_profiles tp ON tp.user_id = u.id
        WHERE u.id = $1`,
      [id],
    );
    const visible =
      tutor && ((tutor.status === 'active' && tutor.approval_status === 'approved') || viewer.id === id || viewer.role === 'admin');
    if (!tutor || !visible) throw notFound('Tutor no encontrado.');

    const offers = await query(
      `SELECT o.id, o.title, o.description, o.modalities, o.hourly_rate, o.km_rate, o.category_id, c.name AS category_name
         FROM offers o JOIN categories c ON c.id = o.category_id
        WHERE o.tutor_id = $1 AND o.active ORDER BY o.created_at`,
      [id],
    );
    const availability = await query(
      'SELECT weekday, start_min, end_min FROM availability WHERE tutor_id = $1 ORDER BY weekday, start_min',
      [id],
    );
    const reviews = await query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS student_name
         FROM reviews r JOIN users u ON u.id = r.student_id
        WHERE r.tutor_id = $1 ORDER BY r.created_at DESC LIMIT 5`,
      [id],
    );
    let distance_km: number | null = null;
    if (viewer.lat !== null && viewer.lng !== null) {
      const d = await queryOne<{ d: number | null }>(
        `SELECT CASE WHEN u.lat IS NULL THEN NULL ELSE ${HAVERSINE('$2', '$3')} END AS d FROM users u WHERE u.id = $1`,
        [id, viewer.lat, viewer.lng],
      );
      distance_km = d?.d ?? null;
    }
    res.json({ tutor: { ...tutor, distance_km }, offers, availability, reviews });
  }),
);

/** Todas las reseñas de un tutor, paginadas. */
tutorsRouter.get(
  '/:id/reviews',
  handler(async (req, res) => {
    const id = paramId(req);
    const { limit, offset } = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) }),
      req.query,
    );
    const reviews = await query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS student_name
         FROM reviews r JOIN users u ON u.id = r.student_id
        WHERE r.tutor_id = $1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    res.json({ reviews });
  }),
);

/** Horarios libres de un tutor para una fecha y duración (excluye lo ocupado por el tutor y por el estudiante). */
tutorsRouter.get(
  '/:id/slots',
  requireRole('student'),
  handler(async (req, res) => {
    const id = paramId(req);
    const { date, minutes } = parse(
      z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), minutes: z.coerce.number().int().default(60) }),
      req.query,
    );
    res.json({ slots: await freeSlots(id, me(req).id, date, minutes) });
  }),
);
