// Migraciones de la base de datos (PostgreSQL). Se aplican en orden y se registran en schema_migrations.
// Las restricciones EXCLUDE (btree_gist) son las que garantizan, a nivel de base de datos,
// que no existan traslapes de horario ni siquiera con peticiones concurrentes.

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'esquema_inicial',
    sql: `
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Archivos subidos (hoja de vida, documento de identificación). Se guardan en la BD
-- porque los discos de los servicios en la nube suelen ser efímeros.
CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid,
  kind        text NOT NULL CHECK (kind IN ('cv', 'identity')),
  filename    text NOT NULL,
  mime        text NOT NULL,
  size        integer NOT NULL,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  parent_id   integer REFERENCES categories(id) ON DELETE CASCADE,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_unique_name ON categories (COALESCE(parent_id, 0), lower(name));

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub            text UNIQUE,
  email                 text NOT NULL,
  name                  text NOT NULL,
  photo_url             text,
  role                  text CHECK (role IN ('student', 'tutor', 'admin')),
  onboarded             boolean NOT NULL DEFAULT false,
  phone                 text,
  gender                text CHECK (gender IN ('masculino', 'femenino', 'otro', 'prefiero_no_decir')),
  address               text,
  lat                   double precision CHECK (lat BETWEEN -90 AND 90),
  lng                   double precision CHECK (lng BETWEEN -180 AND 180),
  id_document_number    text,
  id_document_file_id   uuid REFERENCES files(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  suspended_reason      text,
  suspended_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE user_categories (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE tutor_profiles (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio              text NOT NULL,
  hourly_rate      numeric(10,2) NOT NULL CHECK (hourly_rate >= 0),
  cv_file_id       uuid REFERENCES files(id) ON DELETE SET NULL,
  portfolio_url    text,
  approval_status  text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approval_note    text,
  approved_at      timestamptz,
  rating_avg       numeric(3,2) NOT NULL DEFAULT 0,
  rating_count     integer NOT NULL DEFAULT 0
);

CREATE TABLE offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  integer NOT NULL REFERENCES categories(id),
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  modalities   text[] NOT NULL,
  hourly_rate  numeric(10,2) NOT NULL CHECK (hourly_rate >= 0),
  km_rate      numeric(10,2) NOT NULL DEFAULT 0 CHECK (km_rate >= 0),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(modalities) > 0),
  CHECK (modalities <@ ARRAY['virtual', 'tutor_home', 'student_home']::text[])
);
CREATE INDEX offers_tutor_idx ON offers (tutor_id);
CREATE INDEX offers_category_idx ON offers (category_id);

-- Cuadrícula semanal de disponibilidad. weekday ISO: 1 = lunes ... 7 = domingo. Minutos desde 00:00.
CREATE TABLE availability (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min  smallint NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min    smallint NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  CHECK (end_min > start_min),
  CONSTRAINT availability_no_overlap
    EXCLUDE USING gist (tutor_id WITH =, weekday WITH =, int4range(start_min, end_min) WITH &&)
);

CREATE TABLE subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tutor_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id         uuid NOT NULL REFERENCES offers(id),
  modality         text NOT NULL CHECK (modality IN ('virtual', 'tutor_home', 'student_home')),
  plan             text NOT NULL CHECK (plan IN ('monthly', 'block')),
  weeks            integer NOT NULL CHECK (weeks IN (4, 8, 12)),
  auto_renew       boolean NOT NULL DEFAULT false,
  weekdays         smallint[] NOT NULL,
  start_min        smallint NOT NULL,
  duration_min     integer NOT NULL,
  start_date       date NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'active', 'rejected', 'cancelled', 'finished')),
  student_address  text,
  student_lat      double precision,
  student_lng      double precision,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid REFERENCES subscriptions(id) ON DELETE CASCADE,
  offer_id         uuid NOT NULL REFERENCES offers(id),
  tutor_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  modality         text NOT NULL CHECK (modality IN ('virtual', 'tutor_home', 'student_home')),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  hours            numeric(5,2) NOT NULL,
  hourly_rate      numeric(10,2) NOT NULL,
  base_amount      numeric(10,2) NOT NULL,
  distance_km      numeric(8,2) NOT NULL DEFAULT 0,
  km_rate          numeric(10,2) NOT NULL DEFAULT 0,
  travel_amount    numeric(10,2) NOT NULL DEFAULT 0,
  total_amount     numeric(10,2) NOT NULL,
  student_address  text,
  student_lat      double precision,
  student_lng      double precision,
  notes            text,
  cancelled_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (tutor_id <> student_id),
  -- Un tutor no puede tener dos tutorías pendientes/aprobadas/cumplidas que se traslapen
  CONSTRAINT bookings_tutor_no_overlap
    EXCLUDE USING gist (tutor_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status IN ('pending', 'approved', 'completed')),
  -- Un estudiante tampoco
  CONSTRAINT bookings_student_no_overlap
    EXCLUDE USING gist (student_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status IN ('pending', 'approved', 'completed'))
);
CREATE INDEX bookings_tutor_idx ON bookings (tutor_id, starts_at);
CREATE INDEX bookings_student_idx ON bookings (student_id, starts_at);
CREATE INDEX bookings_subscription_idx ON bookings (subscription_id);

CREATE TABLE conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tutor_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  UNIQUE (student_id, tutor_id)
);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tutor_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_tutor_idx ON reviews (tutor_id, created_at DESC);

CREATE TABLE reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id       uuid REFERENCES bookings(id) ON DELETE SET NULL,
  reason           text NOT NULL CHECK (reason IN ('inasistencia', 'conducta_inapropiada', 'cobros_indebidos', 'otro')),
  description      text NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution_note  text,
  resolved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_id)
);
CREATE INDEX reports_reported_idx ON reports (reported_id);

CREATE TABLE appeals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message         text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  admin_response  text,
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appeals_user_idx ON appeals (user_id);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);

-- Catálogo inicial de categorías
INSERT INTO categories (name, parent_id) VALUES
  ('Idiomas', NULL), ('Deportes', NULL), ('Ciencias', NULL), ('Tecnología', NULL), ('Posgrado', NULL);
INSERT INTO categories (name, parent_id)
  SELECT s.name, p.id FROM (VALUES
    ('Inglés Conversacional', 'Idiomas'), ('Francés', 'Idiomas'),
    ('Natación', 'Deportes'), ('Fútbol', 'Deportes'),
    ('Cálculo Multivariable', 'Ciencias'), ('Física', 'Ciencias'), ('Química', 'Ciencias'),
    ('Desarrollo Web', 'Tecnología'), ('Bases de Datos', 'Tecnología'),
    ('Metodología de la Investigación', 'Posgrado'), ('Estadística Aplicada', 'Posgrado')
  ) AS s(name, parent) JOIN categories p ON p.name = s.parent AND p.parent_id IS NULL;
`,
  },
  {
    id: 2,
    name: 'apelaciones_guardan_motivo_de_suspension',
    sql: `
-- La apelación conserva el motivo y la fecha de la suspensión aunque la cuenta se reactive.
ALTER TABLE appeals ADD COLUMN suspended_reason text, ADD COLUMN suspended_at timestamptz;
UPDATE appeals a SET
  suspended_reason = (SELECT l.data->>'reason' FROM audit_log l
                       WHERE l.action = 'user.suspended' AND l.entity_id = a.user_id::text AND l.created_at <= a.created_at
                       ORDER BY l.created_at DESC LIMIT 1),
  suspended_at = (SELECT l.created_at FROM audit_log l
                   WHERE l.action = 'user.suspended' AND l.entity_id = a.user_id::text AND l.created_at <= a.created_at
                   ORDER BY l.created_at DESC LIMIT 1);
`,
  },
  {
    id: 3,
    name: 'mensajes_del_sistema',
    sql: `
-- Avisos automáticos del sistema dentro de una conversación (p. ej. sesiones canceladas por suspensión).
ALTER TABLE messages ADD COLUMN is_system boolean NOT NULL DEFAULT false;
`,
  },
];
