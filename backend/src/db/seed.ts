// Datos de demostración para probar la aplicación. Es idempotente: no duplica si ya existen.
// Uso: npm run seed   (los usuarios usan google_sub "dev:<correo>", por lo que funcionan con el login de desarrollo)
import { DateTime } from 'luxon';
import { config } from '../config';
import { pool, query, queryOne } from './pool';
import { runMigrations } from './migrate';

interface SeedTutor {
  email: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  bio: string;
  rate: number;
  offers: { category: string; title: string; modalities: string[]; rate: number; km: number }[];
}

const tutors: SeedTutor[] = [
  {
    email: 'ana.tutora@demo.com', name: 'Ana Morales', phone: '+50255550001', address: 'Zona 10, Ciudad de Guatemala',
    lat: 14.5995, lng: -90.5133, rate: 120,
    bio: 'Ingeniera en sistemas con 6 años de experiencia enseñando desarrollo web y bases de datos.',
    offers: [
      { category: 'Desarrollo Web', title: 'React y TypeScript desde cero', modalities: ['virtual', 'tutor_home', 'student_home'], rate: 120, km: 4 },
      { category: 'Bases de Datos', title: 'SQL y modelado de datos', modalities: ['virtual'], rate: 100, km: 0 },
    ],
  },
  {
    email: 'luis.tutor@demo.com', name: 'Luis Ramírez', phone: '+50255550002', address: 'Zona 1, Ciudad de Guatemala',
    lat: 14.6407, lng: -90.5133, rate: 90,
    bio: 'Licenciado en física, apasionado por explicar cálculo y física con ejemplos de la vida diaria.',
    offers: [
      { category: 'Cálculo Multivariable', title: 'Cálculo multivariable para ingeniería', modalities: ['virtual', 'tutor_home'], rate: 90, km: 0 },
      { category: 'Física', title: 'Física universitaria', modalities: ['virtual', 'student_home'], rate: 85, km: 3 },
    ],
  },
  {
    email: 'sofia.tutora@demo.com', name: 'Sofía Herrera', phone: '+50255550003', address: 'Mixco, Guatemala',
    lat: 14.6333, lng: -90.6064, rate: 70,
    bio: 'Profesora bilingüe certificada, con experiencia en conversación y preparación para exámenes de inglés.',
    offers: [{ category: 'Inglés Conversacional', title: 'Conversación en inglés', modalities: ['virtual', 'student_home', 'tutor_home'], rate: 70, km: 3 }],
  },
  {
    email: 'carlos.tutor@demo.com', name: 'Carlos Méndez', phone: '+50255550004', address: 'Antigua Guatemala',
    lat: 14.5586, lng: -90.7295, rate: 150,
    bio: 'Estadístico con maestría, acompaño tesis y análisis de datos con R y Python en posgrado.',
    offers: [{ category: 'Estadística Aplicada', title: 'Estadística para tesis de posgrado', modalities: ['virtual'], rate: 150, km: 0 }],
  },
];

const students = [
  { email: 'maria.estudiante@demo.com', name: 'María López', phone: '+50255551001', address: 'Zona 11, Ciudad de Guatemala', lat: 14.6042, lng: -90.5372 },
  { email: 'jose.estudiante@demo.com', name: 'José Pérez', phone: '+50255551002', address: 'Zona 7, Ciudad de Guatemala', lat: 14.6118, lng: -90.5527 },
];

async function upsertUser(u: { email: string; name: string; phone: string; address: string; lat: number; lng: number }, role: string, categoryName: string): Promise<string> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [u.email]);
  if (existing) return existing.id;
  const created = await queryOne<{ id: string }>(
    `INSERT INTO users (google_sub, email, name, role, onboarded, phone, gender, address, lat, lng, id_document_number)
     VALUES ($1,$2,$3,$4,true,$5,'prefiero_no_decir',$6,$7,$8,$9) RETURNING id`,
    [`dev:${u.email.toLowerCase()}`, u.email, u.name, role, u.phone, u.address, u.lat, u.lng, `DPI-${Math.floor(1000000 + Math.random() * 8999999)}`],
  );
  const id = created?.id as string;
  await query('INSERT INTO user_categories (user_id, category_id) SELECT $1, id FROM categories WHERE name = $2', [id, categoryName]);
  return id;
}

async function main(): Promise<void> {
  await runMigrations();
  for (const email of config.adminEmails) {
    const exists = await queryOne('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (!exists) {
      await query(
        "INSERT INTO users (google_sub, email, name, role, onboarded) VALUES ($1,$2,$3,'admin',true)",
        [`dev:${email}`, email, 'Administrador'],
      );
    }
  }
  const adminDemo = 'admin@demo.com';
  if (!(await queryOne('SELECT id FROM users WHERE lower(email) = $1', [adminDemo]))) {
    await query("INSERT INTO users (google_sub, email, name, role, onboarded) VALUES ($1,$2,'Administrador Demo','admin',true)", [`dev:${adminDemo}`, adminDemo]);
  }

  const tutorIds: string[] = [];
  for (const t of tutors) {
    const id = await upsertUser(t, 'tutor', t.offers[0]?.category ?? 'Física');
    tutorIds.push(id);
    const hasProfile = await queryOne('SELECT user_id FROM tutor_profiles WHERE user_id = $1', [id]);
    if (hasProfile) continue;
    await query(
      `INSERT INTO tutor_profiles (user_id, bio, hourly_rate, portfolio_url, approval_status, approved_at)
       VALUES ($1,$2,$3,$4,'approved', now())`,
      [id, t.bio, t.rate, 'https://github.com/demo'],
    );
    for (const o of t.offers) {
      await query(
        `INSERT INTO offers (tutor_id, category_id, title, description, modalities, hourly_rate, km_rate)
         SELECT $1, c.id, $3, $4, $5, $6, $7 FROM categories c WHERE c.name = $2`,
        [id, o.category, o.title, t.bio, o.modalities, o.rate, o.km],
      );
    }
    for (const weekday of [1, 2, 3, 4, 5]) {
      await query('INSERT INTO availability (tutor_id, weekday, start_min, end_min) VALUES ($1,$2,$3,$4)', [id, weekday, 8 * 60, 12 * 60]);
      await query('INSERT INTO availability (tutor_id, weekday, start_min, end_min) VALUES ($1,$2,$3,$4)', [id, weekday, 14 * 60, 19 * 60]);
    }
    await query('INSERT INTO availability (tutor_id, weekday, start_min, end_min) VALUES ($1,6,$2,$3)', [id, 9 * 60, 13 * 60]);
  }
  const studentIds: string[] = [];
  for (const s of students) studentIds.push(await upsertUser(s, 'student', 'Desarrollo Web'));

  // Historial: tutorías cumplidas con reseñas, para que el ranking y las estadísticas tengan datos
  const hasHistory = await queryOne('SELECT id FROM bookings LIMIT 1');
  if (!hasHistory) {
    const ratings = [5, 4, 5, 3, 4, 5, 2, 4];
    let i = 0;
    for (const [ti, tutorId] of tutorIds.entries()) {
      const offer = await queryOne<{ id: string; category_id: number; hourly_rate: number }>(
        'SELECT id, category_id, hourly_rate FROM offers WHERE tutor_id = $1 ORDER BY created_at LIMIT 1', [tutorId]);
      if (!offer) continue;
      for (let k = 0; k < 2; k += 1) {
        const studentId = studentIds[(ti + k) % studentIds.length] as string;
        const start = DateTime.now().setZone(config.timezone).minus({ days: 20 + ti * 6 + k * 3 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
        const booking = await queryOne<{ id: string }>(
          `INSERT INTO bookings (offer_id, tutor_id, student_id, starts_at, ends_at, modality, status, hours, hourly_rate, base_amount, total_amount)
           VALUES ($1,$2,$3,$4,$5,'virtual','completed',1,$6,$6,$6) RETURNING id`,
          [offer.id, tutorId, studentId, start.toUTC().toISO(), start.plus({ hours: 1 }).toUTC().toISO(), offer.hourly_rate],
        );
        await query('INSERT INTO reviews (booking_id, student_id, tutor_id, rating, comment) VALUES ($1,$2,$3,$4,$5)', [
          booking?.id, studentId, tutorId, ratings[i % ratings.length], 'Muy buena explicación y puntualidad.',
        ]);
        i += 1;
      }
      await query(
        `UPDATE tutor_profiles SET rating_avg = (SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE tutor_id = $1),
                rating_count = (SELECT count(*) FROM reviews WHERE tutor_id = $1) WHERE user_id = $1`, [tutorId]);
    }
    // una tutoría cancelada para la gráfica de sesiones dictadas vs canceladas
    const first = await queryOne<{ id: string; tutor_id: string }>('SELECT id, tutor_id FROM offers ORDER BY created_at LIMIT 1');
    if (first) {
      const start = DateTime.now().setZone(config.timezone).minus({ days: 10 }).set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
      await query(
        `INSERT INTO bookings (offer_id, tutor_id, student_id, starts_at, ends_at, modality, status, hours, hourly_rate, base_amount, total_amount, cancel_reason)
         VALUES ($1,$2,$3,$4,$5,'virtual','cancelled',1,100,100,100,'Cambio de planes')`,
        [first.id, first.tutor_id, studentIds[0], start.toUTC().toISO(), start.plus({ hours: 1 }).toUTC().toISO()],
      );
    }
  }
  console.log('Datos de demostración listos.');
  console.log('Usuarios (login de desarrollo): admin@demo.com, ana.tutora@demo.com, maria.estudiante@demo.com, jose.estudiante@demo.com');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
