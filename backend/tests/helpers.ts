import { DateTime } from 'luxon';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';

export const app = createApp();

export async function resetDb(): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
  await runMigrations();
}

export async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/dev-login').send({ email });
  if (res.status !== 200) throw new Error(`login falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function categoryId(token: string, name: string): Promise<number> {
  const res = await request(app).get('/api/categories').set(auth(token));
  const found = (res.body.categories as { id: number; name: string }[]).find((c) => c.name === name);
  if (!found) throw new Error(`categoría ${name} no existe`);
  return found.id;
}

export interface Place {
  lat: number;
  lng: number;
}

export async function onboardStudent(email: string, place: Place = { lat: 14.6042, lng: -90.5372 }): Promise<string> {
  const token = await login(email);
  const catId = await categoryId(token, 'Desarrollo Web');
  const res = await request(app)
    .put('/api/users/me/onboarding')
    .set(auth(token))
    .send({
      role: 'student', phone: '+50255551234', gender: 'otro', address: 'Zona 11, Guatemala',
      lat: place.lat, lng: place.lng, id_document_number: 'DPI123456', category_ids: [catId],
    });
  if (res.status !== 200) throw new Error(`onboarding estudiante falló: ${JSON.stringify(res.body)}`);
  return token;
}

export async function onboardTutor(
  email: string,
  place: Place = { lat: 14.5995, lng: -90.5133 },
): Promise<string> {
  const token = await login(email);
  const catId = await categoryId(token, 'Desarrollo Web');
  const res = await request(app)
    .put('/api/users/me/onboarding')
    .set(auth(token))
    .send({
      role: 'tutor', phone: '+50255559999', gender: 'femenino', address: 'Zona 10, Guatemala',
      lat: place.lat, lng: place.lng, id_document_number: 'DPI999999', category_ids: [catId],
      tutor: { bio: 'Tutor con amplia experiencia en desarrollo web y bases de datos.', hourly_rate: 100, portfolio_url: 'https://example.com/portafolio' },
    });
  if (res.status !== 200) throw new Error(`onboarding tutor falló: ${JSON.stringify(res.body)}`);
  return token;
}

export async function approveTutor(adminToken: string, tutorEmail: string): Promise<void> {
  const row = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [tutorEmail]);
  const id = row.rows[0]?.id;
  const res = await request(app).post(`/api/admin/tutors/${id}/approval`).set(auth(adminToken)).send({ status: 'approved' });
  if (res.status !== 200) throw new Error(`aprobación falló: ${JSON.stringify(res.body)}`);
}

export async function userId(email: string): Promise<string> {
  const row = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  return row.rows[0]?.id as string;
}

/** Próxima fecha (a partir de mañana) con el día de semana ISO indicado, a la hora indicada, en ISO con zona. */
export function nextWeekday(isoWeekday: number, hour: number, minute = 0, weeksAhead = 1): DateTime {
  let d = DateTime.now().setZone('America/Guatemala').plus({ days: 1 }).startOf('day');
  while (d.weekday !== isoWeekday) d = d.plus({ days: 1 });
  return d.plus({ weeks: weeksAhead - 1 }).set({ hour, minute });
}

/** Tutor completo: aprobado, con una oferta y disponibilidad de lunes a viernes 08:00–18:00. */
export async function setupTutor(
  adminToken: string,
  email: string,
  place?: Place,
  opts: { hourly_rate?: number; km_rate?: number; title?: string } = {},
): Promise<{ token: string; offerId: string; id: string }> {
  const token = await onboardTutor(email, place);
  await approveTutor(adminToken, email);
  const catId = await categoryId(token, 'Desarrollo Web');
  const offer = await request(app)
    .post('/api/offers')
    .set(auth(token))
    .send({
      category_id: catId, title: opts.title ?? 'Tutoría de desarrollo web', description: 'Clases personalizadas',
      modalities: ['virtual', 'tutor_home', 'student_home'], hourly_rate: opts.hourly_rate ?? 100, km_rate: opts.km_rate ?? 5,
    });
  if (offer.status !== 201) throw new Error(`oferta falló: ${JSON.stringify(offer.body)}`);
  const blocks = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_min: 8 * 60, end_min: 18 * 60 }));
  const av = await request(app).put('/api/availability/mine').set(auth(token)).send({ blocks });
  if (av.status !== 200) throw new Error(`disponibilidad falló: ${JSON.stringify(av.body)}`);
  return { token, offerId: offer.body.offer.id as string, id: await userId(email) };
}
