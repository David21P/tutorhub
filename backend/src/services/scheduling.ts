import { DateTime } from 'luxon';
import { PoolClient } from 'pg';
import { config } from '../config';
import { query } from '../db/pool';
import { badRequest } from '../utils/http';

export const SLOT_STEP_MIN = 30;
export const MIN_SESSION_MIN = 30;
export const MAX_SESSION_MIN = 240;

export interface Interval {
  start: number;
  end: number;
}

export interface PlannedSession {
  start: DateTime;
  end: DateTime;
}

export const ACTIVE_STATUSES = ['pending', 'approved', 'completed'];

export function parseInstant(iso: string): DateTime {
  const dt = DateTime.fromISO(iso, { setZone: false }).setZone(config.timezone);
  if (!dt.isValid) throw badRequest(`Fecha u hora inválida: ${iso}`);
  return dt;
}

export function parseDate(date: string): DateTime {
  const dt = DateTime.fromISO(date, { zone: config.timezone }).startOf('day');
  if (!dt.isValid) throw badRequest(`Fecha inválida: ${date}`);
  return dt;
}

export function assertDuration(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < MIN_SESSION_MIN || minutes > MAX_SESSION_MIN || minutes % SLOT_STEP_MIN !== 0) {
    throw badRequest(
      `La duración debe ser múltiplo de ${SLOT_STEP_MIN} minutos entre ${MIN_SESSION_MIN} y ${MAX_SESSION_MIN}.`,
    );
  }
}

/** Intervalos de disponibilidad del tutor en un día de la semana, con los bloques contiguos unidos. */
export async function availabilityFor(tutorId: string, weekday: number, client?: PoolClient): Promise<Interval[]> {
  const rows = await query<{ start_min: number; end_min: number }>(
    'SELECT start_min, end_min FROM availability WHERE tutor_id = $1 AND weekday = $2 ORDER BY start_min',
    [tutorId, weekday],
    client,
  );
  const merged: Interval[] = [];
  for (const row of rows) {
    const last = merged[merged.length - 1];
    if (last && row.start_min <= last.end) last.end = Math.max(last.end, row.end_min);
    else merged.push({ start: row.start_min, end: row.end_min });
  }
  return merged;
}

export function minutesOfDay(dt: DateTime): number {
  return dt.hour * 60 + dt.minute;
}

/** ¿La sesión cabe completa dentro de la disponibilidad semanal del tutor? */
export async function isWithinAvailability(
  tutorId: string,
  session: PlannedSession,
  client?: PoolClient,
): Promise<boolean> {
  if (!session.start.hasSame(session.end.minus({ milliseconds: 1 }), 'day')) return false;
  const intervals = await availabilityFor(tutorId, session.start.weekday, client);
  const s = minutesOfDay(session.start);
  const e = s + session.end.diff(session.start, 'minutes').minutes;
  return intervals.some((i) => s >= i.start && e <= i.end);
}

/** Genera las fechas de una suscripción: todos los días fijos elegidos durante N semanas. */
export function planSessions(input: {
  startDate: string;
  weekdays: number[];
  startMin: number;
  durationMin: number;
  weeks: number;
}): PlannedSession[] {
  const first = parseDate(input.startDate);
  const sessions: PlannedSession[] = [];
  for (let d = 0; d < input.weeks * 7; d += 1) {
    const day = first.plus({ days: d });
    if (!input.weekdays.includes(day.weekday)) continue;
    const start = day.plus({ minutes: input.startMin });
    sessions.push({ start, end: start.plus({ minutes: input.durationMin }) });
  }
  return sessions;
}

export interface Conflict {
  starts_at: string;
  who: 'tutor' | 'student';
}

/**
 * Detecta traslapes con tutorías pendientes, aprobadas o cumplidas del tutor y del estudiante.
 * Es una verificación previa para dar mensajes claros; la garantía real son las restricciones
 * EXCLUDE de la base de datos, que también protegen frente a peticiones concurrentes.
 */
export async function findConflicts(
  sessions: PlannedSession[],
  tutorId: string,
  studentId: string,
  client?: PoolClient,
): Promise<Conflict[]> {
  if (sessions.length === 0) return [];
  const starts = sessions.map((s) => s.start.toUTC().toISO());
  const ends = sessions.map((s) => s.end.toUTC().toISO());
  const rows = await query<{ starts_at: Date; who: 'tutor' | 'student' }>(
    `SELECT s.starts AS starts_at, 'tutor' AS who
       FROM unnest($3::timestamptz[], $4::timestamptz[]) AS s(starts, ends)
       JOIN bookings b ON b.tutor_id = $1 AND b.status = ANY($5)
        AND tstzrange(b.starts_at, b.ends_at) && tstzrange(s.starts, s.ends)
     UNION ALL
     SELECT s.starts, 'student'
       FROM unnest($3::timestamptz[], $4::timestamptz[]) AS s(starts, ends)
       JOIN bookings b ON b.student_id = $2 AND b.status = ANY($5)
        AND tstzrange(b.starts_at, b.ends_at) && tstzrange(s.starts, s.ends)
     ORDER BY starts_at`,
    [tutorId, studentId, starts, ends, ACTIVE_STATUSES],
    client,
  );
  return rows.map((r) => ({
    starts_at: DateTime.fromJSDate(r.starts_at).setZone(config.timezone).toISO() ?? '',
    who: r.who,
  }));
}

export interface Slot {
  starts_at: string;
  ends_at: string;
  label: string;
}

/** Horarios libres de un tutor en una fecha: disponibilidad menos tutorías ocupadas (del tutor y del estudiante). */
export async function freeSlots(
  tutorId: string,
  studentId: string,
  date: string,
  minutes: number,
): Promise<Slot[]> {
  assertDuration(minutes);
  const day = parseDate(date);
  const intervals = await availabilityFor(tutorId, day.weekday);
  const candidates: PlannedSession[] = [];
  for (const interval of intervals) {
    for (let m = interval.start; m + minutes <= interval.end; m += SLOT_STEP_MIN) {
      const start = day.plus({ minutes: m });
      if (start <= DateTime.now().setZone(config.timezone)) continue;
      candidates.push({ start, end: start.plus({ minutes }) });
    }
  }
  const conflicts = await findConflicts(candidates, tutorId, studentId);
  const busy = new Set(conflicts.map((c) => DateTime.fromISO(c.starts_at).toMillis()));
  return candidates
    .filter((c) => !busy.has(c.start.toMillis()))
    .map((c) => ({
      starts_at: c.start.toISO() ?? '',
      ends_at: c.end.toISO() ?? '',
      label: c.start.toFormat('HH:mm'),
    }));
}
