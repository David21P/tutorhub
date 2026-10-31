import { PoolClient } from 'pg';
import { query, queryOne } from '../db/pool';
import { Modality } from '../types';
import { HttpError, badRequest, conflict, notFound } from '../utils/http';
import { LatLng, RouteResult, getRoute } from './geo';
import { PriceBreakdown, computePrice } from './pricing';
import {
  PlannedSession,
  assertDuration,
  findConflicts,
  isWithinAvailability,
} from './scheduling';
import { DateTime } from 'luxon';
import { config } from '../config';

export interface OfferContext {
  offer: {
    id: string;
    tutor_id: string;
    category_id: number;
    title: string;
    modalities: Modality[];
    hourly_rate: number;
    km_rate: number;
  };
  tutor: { id: string; name: string; address: string | null; lat: number | null; lng: number | null };
}

interface OfferContextRow {
  id: string;
  tutor_id: string;
  category_id: number;
  title: string;
  modalities: Modality[];
  hourly_rate: number;
  km_rate: number;
  tutor_name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

/** Carga una oferta publicada, activa y de un tutor aprobado y no suspendido. */
export async function loadOfferContext(offerId: string, client?: PoolClient): Promise<OfferContext> {
  const row = await queryOne<OfferContextRow>(
    `SELECT o.id, o.tutor_id, o.category_id, o.title, o.modalities, o.hourly_rate, o.km_rate,
            u.name AS tutor_name, u.address, u.lat, u.lng
       FROM offers o
       JOIN users u ON u.id = o.tutor_id
       JOIN tutor_profiles tp ON tp.user_id = u.id
      WHERE o.id = $1 AND o.active AND u.status = 'active' AND tp.approval_status = 'approved'`,
    [offerId],
    client,
  );
  if (!row) throw notFound('La oferta no está disponible.');
  return {
    offer: {
      id: row.id,
      tutor_id: row.tutor_id,
      category_id: row.category_id,
      title: row.title,
      modalities: row.modalities,
      hourly_rate: row.hourly_rate,
      km_rate: row.km_rate,
    },
    tutor: { id: row.tutor_id, name: row.tutor_name, address: row.address, lat: row.lat, lng: row.lng },
  };
}

export interface StudentLocation {
  lat: number | null;
  lng: number | null;
  address: string | null;
}

export interface Quote {
  breakdown: PriceBreakdown;
  route: RouteResult | null;
  tutor_location: LatLng | null;
  student_location: LatLng | null;
}

/** Calcula el presupuesto de una sesión y, si es presencial, la ruta real entre tutor y estudiante. */
export async function buildQuote(
  ctx: OfferContext,
  modality: Modality,
  minutes: number,
  student: StudentLocation,
): Promise<Quote> {
  assertDuration(minutes);
  if (!ctx.offer.modalities.includes(modality)) {
    throw badRequest('Esta tutoría no admite la modalidad seleccionada.');
  }
  let route: RouteResult | null = null;
  let tutorLoc: LatLng | null = null;
  let studentLoc: LatLng | null = null;
  if (modality !== 'virtual') {
    if (ctx.tutor.lat === null || ctx.tutor.lng === null) {
      throw badRequest('El tutor no tiene una ubicación registrada.');
    }
    if (student.lat === null || student.lng === null) {
      throw badRequest('Indique su ubicación en el mapa para calcular el traslado.', );
    }
    tutorLoc = { lat: ctx.tutor.lat, lng: ctx.tutor.lng };
    studentLoc = { lat: student.lat, lng: student.lng };
    route = await getRoute(tutorLoc, studentLoc);
  }
  const breakdown = computePrice({
    hourlyRate: ctx.offer.hourly_rate,
    kmRate: ctx.offer.km_rate,
    minutes,
    modality,
    distanceKm: route?.distance_km ?? 0,
  });
  return { breakdown, route, tutor_location: tutorLoc, student_location: studentLoc };
}

/** Verifica que las sesiones sean futuras, entren en la disponibilidad del tutor y no se traslapen. */
export async function assertSessionsBookable(
  sessions: PlannedSession[],
  tutorId: string,
  studentId: string,
  client?: PoolClient,
): Promise<void> {
  const now = DateTime.now().setZone(config.timezone);
  const past = sessions.find((s) => s.start <= now);
  if (past) throw badRequest('Las tutorías deben programarse en una fecha y hora futuras.');

  const outside: string[] = [];
  for (const s of sessions) {
    if (!(await isWithinAvailability(tutorId, s, client))) outside.push(s.start.toISO() ?? '');
  }
  if (outside.length > 0) {
    throw new HttpError(
      422,
      'Algunos horarios están fuera de la disponibilidad del tutor.',
      'OUTSIDE_AVAILABILITY',
      { sessions: outside },
    );
  }
  const conflicts = await findConflicts(sessions, tutorId, studentId, client);
  if (conflicts.length > 0) {
    const tutorSide = conflicts.some((c) => c.who === 'tutor');
    throw conflict(
      tutorSide
        ? 'El tutor ya tiene una tutoría que se traslapa con ese horario.'
        : 'Usted ya tiene una tutoría que se traslapa con ese horario.',
      tutorSide ? 'TUTOR_TIME_CONFLICT' : 'STUDENT_TIME_CONFLICT',
      { conflicts },
    );
  }
}

export interface BookingInsert {
  subscriptionId: string | null;
  ctx: OfferContext;
  studentId: string;
  modality: Modality;
  sessions: PlannedSession[];
  quote: Quote;
  status: 'pending' | 'approved';
  student: StudentLocation;
  notes: string | null;
}

export interface BookingRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  total_amount: number;
}

/** Inserta una fila por sesión. Las restricciones EXCLUDE de la BD son la última barrera contra traslapes. */
export async function insertBookings(client: PoolClient, input: BookingInsert): Promise<BookingRow[]> {
  const rows: BookingRow[] = [];
  const b = input.quote.breakdown;
  for (const s of input.sessions) {
    const inserted = await query<BookingRow>(
      `INSERT INTO bookings
         (subscription_id, offer_id, tutor_id, student_id, starts_at, ends_at, modality, status,
          hours, hourly_rate, base_amount, distance_km, km_rate, travel_amount, total_amount,
          student_address, student_lat, student_lng, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id, starts_at, ends_at, status, total_amount`,
      [
        input.subscriptionId,
        input.ctx.offer.id,
        input.ctx.tutor.id,
        input.studentId,
        s.start.toUTC().toISO(),
        s.end.toUTC().toISO(),
        input.modality,
        input.status,
        b.hours,
        b.hourly_rate,
        b.base_amount,
        b.distance_km,
        b.km_rate,
        b.travel_amount,
        b.total_amount,
        input.student.address,
        input.student.lat,
        input.student.lng,
        input.notes,
      ],
      client,
    );
    const row = inserted[0];
    if (row) rows.push(row);
  }
  return rows;
}
