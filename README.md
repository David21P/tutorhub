# TutorHub — Marketplace educativo

Plataforma que conecta **estudiantes** con **tutores**: búsqueda geoespacial, reservas sin traslapes, suscripciones recurrentes,
chat en tiempo real, reseñas, reportes, suspensión de cuentas con apelaciones y panel de administración con analítica.

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + TypeScript + SASS/SCSS (Vite), React Router, Leaflet/OpenStreetMap, FullCalendar, Recharts, Socket.io-client |
| Backend | Node 22 + Express + TypeScript (estricto), Zod, Socket.io |
| Base de datos | PostgreSQL (restricciones `EXCLUDE` con `btree_gist` contra traslapes) |
| Autenticación | Google OAuth 2.0 (ID token) + JWT en el header `Authorization: Bearer` |

## Estructura

```
backend/    API REST + Socket.io (src/routes, services, middleware, sockets, db) y pruebas (tests/)
frontend/   SPA React (src/pages, components, context, styles)
```

## Ejecución local

Requisitos: Node 20+ y PostgreSQL 14+.

```bash
# 1) Base de datos
createdb tutordb            # o use su propia instancia
# (el usuario necesita permiso para CREATE EXTENSION btree_gist; en PostgreSQL gestionado ya viene habilitada)

# 2) Backend
cd backend
cp .env.example .env        # ajuste DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID, ADMIN_EMAILS
npm install
npm run seed                # migra la BD y carga datos de demostración (opcional)
npm run dev                 # http://localhost:5000

# 3) Frontend (otra terminal)
cd frontend
cp .env.example .env        # VITE_GOOGLE_CLIENT_ID, VITE_ENABLE_DEV_LOGIN
npm install
npm run dev                 # http://localhost:5173 (el proxy de Vite envía /api y /socket.io al backend)
```

Las migraciones se aplican solas al arrancar el servidor (`npm run migrate` las ejecuta manualmente).

### Acceso de desarrollo (sin Google)
Con `ENABLE_DEV_LOGIN=true` (backend) y `VITE_ENABLE_DEV_LOGIN=true` (frontend) el login muestra un acceso por correo.
Usuarios de `npm run seed`: `admin@demo.com`, `ana.tutora@demo.com`, `luis.tutor@demo.com`, `maria.estudiante@demo.com`, `jose.estudiante@demo.com`.
**El backend se niega a arrancar en producción con `ENABLE_DEV_LOGIN=true`.**

### Google OAuth 2.0
1. Google Cloud Console → *APIs y servicios* → *Credenciales* → **ID de cliente de OAuth** (tipo *Aplicación web*).
2. *Orígenes autorizados de JavaScript*: `http://localhost:5173` y la URL pública del frontend.
3. Copie el Client ID en `GOOGLE_CLIENT_ID` (backend) y `VITE_GOOGLE_CLIENT_ID` (frontend).
4. Los correos de `ADMIN_EMAILS` (separados por coma) reciben el rol **administrador** al iniciar sesión.

## Variables de entorno

**Backend** (`backend/.env.example`): `PORT`, `DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET`, `JWT_EXPIRES_IN` (duración del token, p. ej. `15m`, `2h`),
`GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `FRONTEND_URL` (CORS, admite varias separadas por coma), `APP_TIMEZONE`, `OSRM_URL`, `TRAVEL_ROUND_TRIP`, `ENABLE_DEV_LOGIN`.

**Frontend** (`frontend/.env.example`): `VITE_API_URL` (URL del backend; vacío en desarrollo), `VITE_GOOGLE_CLIENT_ID`, `VITE_ENABLE_DEV_LOGIN`.

## Pruebas

```bash
cd backend
createdb tutordb_test && psql tutordb_test -c "CREATE EXTENSION btree_gist"
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/tutordb_test npm test
```
39 pruebas de integración: JWT (faltante/inválido/vencido), onboarding, búsqueda geoespacial, presupuesto con traslado, traslapes (incluida concurrencia),
suscripciones, reseñas, chat por Socket.io, reportes → suspensión → apelación → reactivación, CRUD de categorías, estadísticas y auditoría.

## Decisiones de diseño relevantes

- **JWT en toda la API**: todo `/api/*` exige `Authorization: Bearer <jwt>` salvo `/api/auth/google` (y el login de desarrollo). El interceptor de Axios adjunta el token; ante un `401` (token faltante, inválido o vencido) el frontend cierra sesión y redirige al login con un aviso. El socket también valida el JWT en el handshake.
- **Cero traslapes**: restricciones `EXCLUDE USING gist` sobre las tutorías `pending/approved/completed` del tutor y del estudiante; además hay validación previa con mensajes claros. Una solicitud pendiente ya bloquea el horario.
- **Distancia y traslado**: ruta real con OSRM (OpenStreetMap) y mapa Leaflet; si OSRM no responde se estima (línea recta × 1.3, marcado como “estimada”). El traslado (`km × tarifa por km`) solo se cobra cuando el tutor va al domicilio del estudiante.
- **Suscripciones**: mensual (4 semanas, renovación automática opcional) o bloques de 4/8 semanas con días y hora fijos; todo o nada si alguna sesión no es viable.
- **Reseñas**: una por tutoría cumplida; el promedio y la cantidad se recalculan en la misma transacción y se registran en la bitácora de auditoría.
- **Suspensión**: la cuenta puede iniciar sesión pero solo accede a `/api/account/*` y `/api/auth/me`; el frontend muestra únicamente la vista de suspensión (motivo, fecha, políticas y apelación). Aceptar una apelación reactiva la cuenta al instante.
- **Archivos** (hoja de vida / documento) se guardan en la base de datos (discos de la nube suelen ser efímeros). Máx. 3 MB.

## Despliegue (resumen; se detallará paso a paso)
- **Base de datos**: PostgreSQL en Render.
- **Backend**: Web Service en Render (`Root Directory: backend`, build `npm install && npm run build`, start `npm start`) con las variables del backend y `DATABASE_SSL=true`.
- **Frontend**: Static Site en Render o Netlify (`Root Directory: frontend`, build `npm install && npm run build`, publish `dist`), con `VITE_API_URL` apuntando al backend. En Render agregue una regla *Rewrite* `/*` → `/index.html`.
