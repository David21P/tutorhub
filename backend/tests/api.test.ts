import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { pool } from '../src/db/pool';
import {
  app, auth, categoryId, login, nextWeekday, onboardStudent, resetDb, setupTutor, userId,
} from './helpers';

let admin: string;
let tutorA: { token: string; offerId: string; id: string };
let tutorB: { token: string; offerId: string; id: string };
let student1: string;
let student2: string;

beforeAll(async () => {
  await resetDb();
  admin = await login('admin@test.com');
  tutorA = await setupTutor(admin, 'tutora@test.com', { lat: 14.5995, lng: -90.5133 }, { hourly_rate: 100, km_rate: 5 });
  tutorB = await setupTutor(admin, 'tutorb@test.com', { lat: 14.9, lng: -91.1 }, { hourly_rate: 200, km_rate: 8, title: 'Tutoría avanzada' });
  student1 = await onboardStudent('est1@test.com');
  student2 = await onboardStudent('est2@test.com');
});

afterAll(async () => {
  await pool.end();
});

describe('autenticación JWT', () => {
  it('rechaza peticiones sin token', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_REQUIRED');
  });

  it('rechaza un token inválido', async () => {
    const res = await request(app).get('/api/categories').set(auth('abc.def.ghi'));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('rechaza un token vencido con código TOKEN_EXPIRED', async () => {
    const id = await userId('est1@test.com');
    const expired = jwt.sign({ sub: id }, config.jwtSecret, { expiresIn: -10 });
    const res = await request(app).get('/api/auth/me').set(auth(expired));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('el login de Google exige una credencial válida', async () => {
    const res = await request(app).post('/api/auth/google').send({ credential: 'no-es-un-token-de-google' });
    expect(res.status).toBe(401);
  });

  it('/health es público', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('el correo en ADMIN_EMAILS obtiene rol admin', async () => {
    const res = await request(app).get('/api/auth/me').set(auth(admin));
    expect(res.body.user.role).toBe('admin');
  });
});

describe('onboarding', () => {
  it('un usuario sin perfil completo no puede usar la API', async () => {
    const t = await login('nuevo@test.com');
    const res = await request(app).get('/api/tutors/search').set(auth(t));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ONBOARDING_REQUIRED');
  });

  it('un tutor debe adjuntar hoja de vida o portafolio', async () => {
    const t = await login('tutorsincv@test.com');
    const catId = await categoryId(t, 'Física');
    const res = await request(app).put('/api/users/me/onboarding').set(auth(t)).send({
      role: 'tutor', phone: '+50255550000', gender: 'otro', address: 'Zona 1', lat: 14.6, lng: -90.5,
      id_document_number: 'DPI00001', category_ids: [catId],
      tutor: { bio: 'Biografía suficientemente larga para validar', hourly_rate: 50 },
    });
    expect(res.status).toBe(400);
  });

  it('un tutor sin aprobar no puede publicar ofertas ni aparece en la búsqueda', async () => {
    const { onboardTutor } = await import('./helpers');
    const t = await onboardTutor('pendiente@test.com');
    const catId = await categoryId(t, 'Física');
    const offer = await request(app).post('/api/offers').set(auth(t)).send({
      category_id: catId, title: 'Física general', modalities: ['virtual'], hourly_rate: 50, km_rate: 0,
    });
    expect(offer.status).toBe(403);
    expect(offer.body.code).toBe('TUTOR_NOT_APPROVED');
    const search = await request(app).get('/api/tutors/search').set(auth(student1));
    expect(search.body.tutors.map((x: { tutor_name: string }) => x.tutor_name)).not.toContain('pendiente');
  });
});

describe('búsqueda geoespacial', () => {
  it('filtra por radio, precio y modalidad', async () => {
    const all = await request(app).get('/api/tutors/search').set(auth(student1)).query({ lat: 14.6042, lng: -90.5372 });
    expect(all.status).toBe(200);
    expect(all.body.tutors).toHaveLength(2);
    // ordenados por cercanía
    expect(all.body.tutors[0].tutor_id).toBe(tutorA.id);
    expect(all.body.tutors[0].distance_km).toBeLessThan(10);

    const near = await request(app).get('/api/tutors/search').set(auth(student1)).query({ lat: 14.6042, lng: -90.5372, radius_km: 20 });
    expect(near.body.tutors.map((t: { tutor_id: string }) => t.tutor_id)).toEqual([tutorA.id]);

    const cheap = await request(app).get('/api/tutors/search').set(auth(student1)).query({ max_price: 150 });
    expect(cheap.body.tutors.map((t: { tutor_id: string }) => t.tutor_id)).toEqual([tutorA.id]);

    const virtual = await request(app).get('/api/tutors/search').set(auth(student1)).query({ modality: 'virtual' });
    expect(virtual.body.tutors).toHaveLength(2);
  });

  it('el radio exige ubicación', async () => {
    const res = await request(app).get('/api/tutors/search').set(auth(student1)).query({ radius_km: 5 });
    expect(res.status).toBe(400);
  });

  it('filtra por categoría (incluye subcategorías)', async () => {
    const parent = await categoryId(student1, 'Tecnología');
    const res = await request(app).get('/api/tutors/search').set(auth(student1)).query({ category_id: parent });
    expect(res.body.tutors).toHaveLength(2);
    const other = await categoryId(student1, 'Idiomas');
    const none = await request(app).get('/api/tutors/search').set(auth(student1)).query({ category_id: other });
    expect(none.body.tutors).toHaveLength(0);
  });
});

describe('presupuesto', () => {
  it('desglosa tarifa base y traslado por km solo para el domicilio del estudiante', async () => {
    const q = await request(app).post('/api/bookings/quote').set(auth(student1)).send({
      offer_id: tutorA.offerId, modality: 'student_home', minutes: 90,
    });
    expect(q.status).toBe(200);
    const b = q.body.quote.breakdown;
    expect(b.base_amount).toBe(150);
    expect(b.distance_km).toBeGreaterThan(0);
    expect(b.travel_amount).toBeCloseTo(b.distance_km * 5, 1);
    expect(b.total_amount).toBeCloseTo(150 + b.travel_amount, 1);
    expect(q.body.quote.route.geometry.length).toBeGreaterThanOrEqual(2);

    const v = await request(app).post('/api/bookings/quote').set(auth(student1)).send({
      offer_id: tutorA.offerId, modality: 'virtual', minutes: 60,
    });
    expect(v.body.quote.breakdown.travel_amount).toBe(0);
    expect(v.body.quote.breakdown.total_amount).toBe(100);

    const th = await request(app).post('/api/bookings/quote').set(auth(student1)).send({
      offer_id: tutorA.offerId, modality: 'tutor_home', minutes: 60,
    });
    expect(th.body.quote.breakdown.travel_amount).toBe(0);
    expect(th.body.quote.route).not.toBeNull();
  });

  it('rechaza duraciones inválidas', async () => {
    const q = await request(app).post('/api/bookings/quote').set(auth(student1)).send({
      offer_id: tutorA.offerId, modality: 'virtual', minutes: 45,
    });
    expect(q.status).toBe(400);
  });
});

describe('reservas y control de traslapes', () => {
  const book = (token: string, offerId: string, startsAt: string, minutes = 60) =>
    request(app).post('/api/bookings').set(auth(token)).send({ offer_id: offerId, modality: 'virtual', starts_at: startsAt, minutes });

  it('rechaza horarios fuera de la disponibilidad del tutor', async () => {
    const res = await book(student1, tutorA.offerId, nextWeekday(1, 20).toISO() as string);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OUTSIDE_AVAILABILITY');
    const sunday = await book(student1, tutorA.offerId, nextWeekday(7, 10).toISO() as string);
    expect(sunday.status).toBe(422);
  });

  it('rechaza fechas pasadas', async () => {
    const res = await book(student1, tutorA.offerId, '2020-01-06T10:00:00-06:00');
    expect(res.status).toBe(400);
  });

  it('impide que dos estudiantes tomen el mismo horario del tutor', async () => {
    const start = nextWeekday(2, 9);
    const first = await book(student1, tutorA.offerId, start.toISO() as string, 60);
    expect(first.status).toBe(201);
    const second = await book(student2, tutorA.offerId, start.plus({ minutes: 30 }).toISO() as string, 60);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('TUTOR_TIME_CONFLICT');
    // el horario contiguo sí está libre
    const adjacent = await book(student2, tutorA.offerId, start.plus({ hours: 1 }).toISO() as string, 60);
    expect(adjacent.status).toBe(201);
  });

  it('impide que un estudiante tenga dos tutorías al mismo tiempo con tutores distintos', async () => {
    const start = nextWeekday(2, 9);
    const res = await book(student1, tutorB.offerId, start.toISO() as string, 60);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STUDENT_TIME_CONFLICT');
  });

  it('el horario aprobado sigue bloqueado y el cancelado se libera', async () => {
    const start = nextWeekday(3, 10);
    const created = await book(student1, tutorA.offerId, start.toISO() as string);
    expect(created.status).toBe(201);
    const id = created.body.booking.id as string;
    const approve = await request(app).post(`/api/bookings/${id}/approve`).set(auth(tutorA.token));
    expect(approve.status).toBe(200);
    expect((await book(student2, tutorA.offerId, start.toISO() as string)).status).toBe(409);
    const cancel = await request(app).post(`/api/bookings/${id}/cancel`).set(auth(student1)).send({ reason: 'Imprevisto' });
    expect(cancel.status).toBe(200);
    expect((await book(student2, tutorA.offerId, start.toISO() as string)).status).toBe(201);
  });

  it('solo una de varias solicitudes simultáneas obtiene el horario', async () => {
    const start = nextWeekday(4, 15).toISO() as string;
    const tokens = [student1, student2, student1, student2, student1];
    const results = await Promise.all(tokens.map((t) => book(t, tutorA.offerId, start)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).length).toBeGreaterThanOrEqual(1);
  });

  it('la lista de horarios libres excluye lo ocupado', async () => {
    const date = nextWeekday(2, 9).toISODate() as string;
    const res = await request(app).get(`/api/tutors/${tutorA.id}/slots`).set(auth(student2)).query({ date, minutes: 60 });
    expect(res.status).toBe(200);
    const labels = (res.body.slots as { label: string }[]).map((s) => s.label);
    expect(labels).not.toContain('09:00');
    expect(labels).toContain('08:00');
  });

  it('solo el tutor responde y un tercero no ve la tutoría', async () => {
    const start = nextWeekday(5, 11);
    const created = await book(student1, tutorA.offerId, start.toISO() as string);
    const id = created.body.booking.id as string;
    expect((await request(app).post(`/api/bookings/${id}/approve`).set(auth(student1))).status).toBe(403);
    expect((await request(app).get(`/api/bookings/${id}`).set(auth(tutorB.token))).status).toBe(404);
    expect((await request(app).post(`/api/bookings/${id}/reject`).set(auth(tutorA.token))).status).toBe(200);
  });

  it('el calendario filtra por rango de fechas', async () => {
    const from = nextWeekday(1, 0).startOf('week').toISO() as string;
    const to = nextWeekday(1, 0).startOf('week').plus({ weeks: 2 }).toISO() as string;
    const res = await request(app).get('/api/bookings').set(auth(student1)).query({ from, to });
    expect(res.status).toBe(200);
    expect(res.body.bookings.length).toBeGreaterThan(0);
  });
});

describe('suscripciones recurrentes', () => {
  const sub = (token: string, offerId: string, over: Record<string, unknown> = {}) => ({
    offer_id: offerId, modality: 'virtual', plan: 'monthly', weekdays: [1, 3], start_min: 16 * 60, duration_min: 60,
    start_date: nextWeekday(1, 0, 0, 2).toISODate(), auto_renew: false, ...over,
  } as Record<string, unknown> & { token?: string });

  it('genera las sesiones de 4 semanas, las aprueba en bloque y las bloquea', async () => {
    const preview = await request(app).post('/api/subscriptions/preview').set(auth(student1)).send(sub(student1, tutorA.offerId));
    expect(preview.status).toBe(200);
    expect(preview.body.sessions).toHaveLength(8);
    expect(preview.body.ok).toBe(true);
    expect(preview.body.total_amount).toBe(800);

    const created = await request(app).post('/api/subscriptions').set(auth(student1)).send(sub(student1, tutorA.offerId));
    expect(created.status).toBe(201);
    expect(created.body.subscription.sessions).toBe(8);
    const id = created.body.subscription.id as string;

    const approve = await request(app).post(`/api/subscriptions/${id}/approve`).set(auth(tutorA.token));
    expect(approve.status).toBe(200);
    const bookings = await request(app).get(`/api/subscriptions/${id}/bookings`).set(auth(student1));
    expect(bookings.body.bookings.every((b: { status: string }) => b.status === 'approved')).toBe(true);

    // otro estudiante no puede tomar uno de esos horarios
    const clash = await request(app).post('/api/subscriptions').set(auth(student2)).send(sub(student2, tutorA.offerId, { weekdays: [1] }));
    expect(clash.status).toBe(409);
    const count = await pool.query("SELECT count(*)::int AS n FROM subscriptions WHERE student_id = (SELECT id FROM users WHERE email='est2@test.com')");
    expect(count.rows[0].n).toBe(0); // todo o nada
  });

  it('un bloque de 8 semanas genera el doble de sesiones', async () => {
    const res = await request(app).post('/api/subscriptions/preview').set(auth(student2)).send(
      sub(student2, tutorA.offerId, { plan: 'block', weeks: 8, weekdays: [2], start_min: 17 * 60, start_date: nextWeekday(2, 0, 0, 5).toISODate() }),
    );
    expect(res.body.sessions).toHaveLength(8);
    const bad = await request(app).post('/api/subscriptions/preview').set(auth(student2)).send(sub(student2, tutorA.offerId, { plan: 'block', weeks: 6 }));
    expect(bad.status).toBe(400);
  });

  it('la cancelación libera las sesiones futuras', async () => {
    const created = await request(app).post('/api/subscriptions').set(auth(student2)).send(
      sub(student2, tutorA.offerId, { weekdays: [5], start_min: 9 * 60, start_date: nextWeekday(5, 0, 0, 6).toISODate() }),
    );
    expect(created.status).toBe(201);
    const id = created.body.subscription.id as string;
    expect((await request(app).post(`/api/subscriptions/${id}/cancel`).set(auth(student2))).status).toBe(200);
    const left = await pool.query("SELECT count(*)::int AS n FROM bookings WHERE subscription_id = $1 AND status IN ('pending','approved')", [id]);
    expect(left.rows[0].n).toBe(0);
  });

  it('la renovación manual agrega otro bloque a continuación', async () => {
    const created = await request(app).post('/api/subscriptions').set(auth(student1)).send(
      sub(student1, tutorB.offerId, { weekdays: [2], start_min: 12 * 60, start_date: nextWeekday(2, 0, 0, 3).toISODate() }),
    );
    const id = created.body.subscription.id as string;
    await request(app).post(`/api/subscriptions/${id}/approve`).set(auth(tutorB.token));
    const renew = await request(app).post(`/api/subscriptions/${id}/renew`).set(auth(student1));
    expect(renew.status).toBe(200);
    expect(renew.body.added).toBe(4);
    const total = await pool.query("SELECT count(*)::int AS n FROM bookings WHERE subscription_id = $1", [id]);
    expect(total.rows[0].n).toBe(8);
  });
});

describe('reseñas', () => {
  it('actualiza de inmediato el promedio y solo permite una reseña por tutoría cumplida', async () => {
    const start = nextWeekday(1, 8, 0, 3);
    const created = await request(app).post('/api/bookings').set(auth(student1)).send({
      offer_id: tutorB.offerId, modality: 'virtual', starts_at: start.toISO(), minutes: 60,
    });
    const id = created.body.booking.id as string;
    // todavía no cumplida
    const early = await request(app).post('/api/reviews').set(auth(student1)).send({ booking_id: id, rating: 5 });
    expect(early.status).toBe(409);
    // simular que la tutoría ya ocurrió
    await pool.query(
      "UPDATE bookings SET status='completed', starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = $1",
      [id],
    );
    const ok = await request(app).post('/api/reviews').set(auth(student1)).send({ booking_id: id, rating: 4, comment: 'Excelente' });
    expect(ok.status).toBe(201);
    expect(ok.body.review.rating_avg).toBe(4);
    expect(ok.body.review.rating_count).toBe(1);
    expect((await request(app).post('/api/reviews').set(auth(student1)).send({ booking_id: id, rating: 5 })).status).toBe(409);
    expect((await request(app).post('/api/reviews').set(auth(student2)).send({ booking_id: id, rating: 5 })).status).toBe(403);

    const profile = await request(app).get(`/api/tutors/${tutorB.id}`).set(auth(student2));
    expect(profile.body.tutor.rating_avg).toBe(4);
    const audit = await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'review.created'");
    expect(audit.rows[0].n).toBe(1);
  });

  it('valida el rango 1–5 y filtra por calificación mínima', async () => {
    expect((await request(app).post('/api/reviews').set(auth(student1)).send({ booking_id: '00000000-0000-0000-0000-000000000000', rating: 6 })).status).toBe(400);
    const res = await request(app).get('/api/tutors/search').set(auth(student1)).query({ min_rating: 4, min_reviews: 1 });
    expect(res.body.tutors.map((t: { tutor_id: string }) => t.tutor_id)).toEqual([tutorB.id]);
  });
});

describe('chat', () => {
  it('permite conversar, cuenta no leídos y marca como leído', async () => {
    const conv = await request(app).post('/api/chat/conversations').set(auth(student1)).send({ tutor_id: tutorA.id });
    expect(conv.status).toBe(201);
    const id = conv.body.id as string;
    const again = await request(app).post('/api/chat/conversations').set(auth(student1)).send({ tutor_id: tutorA.id });
    expect(again.body.id).toBe(id);
    expect((await request(app).post(`/api/chat/conversations/${id}/messages`).set(auth(student1)).send({ body: 'Hola, ¿tienes cupo?' })).status).toBe(201);
    const list = await request(app).get('/api/chat/conversations').set(auth(tutorA.token));
    expect(list.body.conversations[0].unread).toBe(1);
    expect((await request(app).get(`/api/chat/conversations/${id}/messages`).set(auth(student2))).status).toBe(403);
    const read = await request(app).post(`/api/chat/conversations/${id}/read`).set(auth(tutorA.token));
    expect(read.body.updated).toBe(1);
    const msgs = await request(app).get(`/api/chat/conversations/${id}/messages`).set(auth(student1));
    expect(msgs.body.messages[0].read_at).not.toBeNull();
    expect(msgs.body.messages[0].created_at).toBeTruthy();
  });
});

describe('reportes, suspensión y apelaciones', () => {
  it('flujo completo: reporte → suspensión → vista restringida → apelación → reactivación inmediata', async () => {
    // student1 tiene reservas con tutorA, por lo que puede reportarlo
    const report = await request(app).post('/api/reports').set(auth(student1)).send({
      reported_id: tutorA.id, reason: 'inasistencia', description: 'El tutor no se presentó a la sesión acordada y no avisó.',
    });
    expect(report.status).toBe(201);
    const short = await request(app).post('/api/reports').set(auth(student1)).send({ reported_id: tutorA.id, reason: 'otro', description: 'corto' });
    expect(short.status).toBe(400);

    const inbox = await request(app).get('/api/admin/reports').set(auth(admin));
    expect(inbox.body.reports).toHaveLength(1);
    expect((await request(app).get('/api/admin/reports').set(auth(student1))).status).toBe(403);

    const resolve = await request(app).post(`/api/admin/reports/${report.body.report.id}/resolve`).set(auth(admin)).send({
      status: 'resolved', note: 'Se confirma la inasistencia', suspend_reason: 'Inasistencia comprobada a una tutoría',
    });
    expect(resolve.status).toBe(200);
    expect((await request(app).get('/api/admin/reports').query({ view: 'history' }).set(auth(admin))).body.reports).toHaveLength(1);

    // el tutor suspendido puede entrar pero solo ve la suspensión
    const t = await login('tutora@test.com');
    expect((await request(app).get('/api/auth/me').set(auth(t))).body.user.status).toBe('suspended');
    expect((await request(app).get('/api/offers/mine').set(auth(t))).body.code).toBe('ACCOUNT_SUSPENDED');
    expect((await request(app).get('/api/bookings').set(auth(t))).status).toBe(403);
    const info = await request(app).get('/api/account/suspension').set(auth(t));
    expect(info.status).toBe(200);
    expect(info.body.reason).toContain('Inasistencia');
    expect(info.body.suspended_at).toBeTruthy();
    expect(info.body.policies_url).toBeTruthy();

    // desaparece de la búsqueda
    const search = await request(app).get('/api/tutors/search').set(auth(student1));
    expect(search.body.tutors.map((x: { tutor_id: string }) => x.tutor_id)).not.toContain(tutorA.id);

    // apelación
    expect((await request(app).post('/api/account/appeals').set(auth(t)).send({ message: 'corto' })).status).toBe(400);
    const appeal = await request(app).post('/api/account/appeals').set(auth(t)).send({ message: 'Tuve una emergencia médica y no pude avisar a tiempo.' });
    expect(appeal.status).toBe(201);
    expect((await request(app).post('/api/account/appeals').set(auth(t)).send({ message: 'Otra apelación igual de larga que la anterior.' })).status).toBe(409);
    const pending = await request(app).get('/api/admin/appeals').set(auth(admin));
    expect(pending.body.appeals).toHaveLength(1);

    const accept = await request(app).post(`/api/admin/appeals/${appeal.body.appeal.id}/resolve`).set(auth(admin)).send({
      decision: 'accepted', response: 'Se acepta la apelación con la documentación.',
    });
    expect(accept.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(auth(t))).body.user.status).toBe('active');
    expect((await request(app).get('/api/offers/mine').set(auth(t))).status).toBe(200);
    const history = await request(app).get('/api/admin/appeals').query({ view: 'history' }).set(auth(admin));
    expect(history.body.appeals[0].status).toBe('accepted');
  });

  it('una apelación rechazada mantiene la cuenta suspendida', async () => {
    const id = await userId('est2@test.com');
    expect((await request(app).post(`/api/admin/users/${id}/suspend`).set(auth(admin)).send({ reason: 'Conducta inapropiada reiterada' })).status).toBe(200);
    const t = await login('est2@test.com');
    const appeal = await request(app).post('/api/account/appeals').set(auth(t)).send({ message: 'Considero que la suspensión fue injusta, por favor revisen.' });
    await request(app).post(`/api/admin/appeals/${appeal.body.appeal.id}/resolve`).set(auth(admin)).send({ decision: 'rejected', response: 'Se mantiene la sanción.' });
    expect((await request(app).get('/api/auth/me').set(auth(t))).body.user.status).toBe('suspended');
    expect((await request(app).post(`/api/admin/users/${id}/reactivate`).set(auth(admin))).status).toBe(200);
  });

  it('al suspender un tutor se cancelan sus tutorías próximas, se avisa por chat y reactivar no las restaura', async () => {
    const start = nextWeekday(3, 15, 0, 4);
    const created = await request(app).post('/api/bookings').set(auth(student2)).send({
      offer_id: tutorB.offerId, modality: 'virtual', starts_at: start.toISO(), minutes: 60,
    });
    expect(created.status).toBe(201);
    const bookingId = created.body.booking.id as string;
    await request(app).post(`/api/bookings/${bookingId}/approve`).set(auth(tutorB.token));

    expect((await request(app).post(`/api/admin/users/${tutorB.id}/suspend`).set(auth(admin)).send({ reason: 'Incumplimiento de las políticas' })).status).toBe(200);

    const row = await pool.query('SELECT status, cancel_reason FROM bookings WHERE id = $1', [bookingId]);
    expect(row.rows[0].status).toBe('cancelled');
    expect(row.rows[0].cancel_reason).toBe('Cuenta del tutor suspendida');

    const convs = await request(app).get('/api/chat/conversations').set(auth(student2));
    const conv = (convs.body.conversations as { id: string }[]).find((c) => c.id);
    expect(conv).toBeTruthy();
    const msgs = await request(app).get(`/api/chat/conversations/${conv?.id}/messages`).set(auth(student2));
    const notice = (msgs.body.messages as { is_system: boolean; body: string }[]).find((m) => m.is_system);
    expect(notice?.body).toContain('fue suspendida');

    await request(app).post(`/api/admin/users/${tutorB.id}/reactivate`).set(auth(admin));
    const after = await pool.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
    expect(after.rows[0].status).toBe('cancelled');
  });

  it('no se puede suspender a un administrador', async () => {
    const id = await userId('admin@test.com');
    expect((await request(app).post(`/api/admin/users/${id}/suspend`).set(auth(admin)).send({ reason: 'Prueba de suspensión' })).status).toBe(400);
  });
});

describe('administración', () => {
  it('CRUD de categorías y subcategorías', async () => {
    const created = await request(app).post('/api/admin/categories').set(auth(admin)).send({ name: 'Música' });
    expect(created.status).toBe(201);
    const parent = created.body.category.id as number;
    const sub = await request(app).post('/api/admin/categories').set(auth(admin)).send({ name: 'Guitarra', parent_id: parent });
    expect(sub.status).toBe(201);
    expect((await request(app).post('/api/admin/categories').set(auth(admin)).send({ name: 'Acústica', parent_id: sub.body.category.id })).status).toBe(400);
    expect((await request(app).post('/api/admin/categories').set(auth(admin)).send({ name: 'música' })).status).toBe(409);
    expect((await request(app).put(`/api/admin/categories/${sub.body.category.id}`).set(auth(admin)).send({ name: 'Guitarra eléctrica', active: true })).body.category.name).toBe('Guitarra eléctrica');
    expect((await request(app).delete(`/api/admin/categories/${parent}`).set(auth(admin))).body.deleted).toBe(true);
    // una categoría con ofertas se desactiva en lugar de borrarse
    const web = await categoryId(admin, 'Desarrollo Web');
    const del = await request(app).delete(`/api/admin/categories/${web}`).set(auth(admin));
    expect(del.body.deactivated).toBe(true);
    await request(app).put(`/api/admin/categories/${web}`).set(auth(admin)).send({ name: 'Desarrollo Web', active: true });
  });

  it('las estadísticas devuelven ranking, horas por categoría y sesiones por mes', async () => {
    const res = await request(app).get('/api/admin/stats').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.best_tutors[0].id).toBe(tutorB.id);
    expect(res.body.hours_by_category.length).toBeGreaterThan(0);
    expect(res.body.sessions_by_month.length).toBeGreaterThan(0);
    expect(res.body.sessions_by_month[0]).toHaveProperty('taught');
    expect(res.body.sessions_by_month[0]).toHaveProperty('cancelled');
    expect(res.body.totals.students).toBeGreaterThanOrEqual(2);
    expect((await request(app).get('/api/admin/stats').set(auth(student1))).status).toBe(403);
  });

  it('la bitácora de auditoría registra las acciones clave', async () => {
    const res = await request(app).get('/api/admin/audit').set(auth(admin));
    const actions = (res.body.entries as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['user.suspended', 'user.reactivated', 'review.created', 'report.resolved']));
  });
});

describe('archivos', () => {
  it('sube un PDF y restringe el documento de identificación a su dueño', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const up = await request(app).post('/api/files').set(auth(student1)).field('kind', 'identity').attach('file', pdf, { filename: 'dpi.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect((await request(app).get(`/api/files/${up.body.id}`).set(auth(student1))).status).toBe(200);
    expect((await request(app).get(`/api/files/${up.body.id}`).set(auth(admin))).status).toBe(200);
    expect((await request(app).get(`/api/files/${up.body.id}`).set(auth(tutorB.token))).status).toBe(403);
    const bad = await request(app).post('/api/files').set(auth(student1)).field('kind', 'cv').attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(400);
  });
});
