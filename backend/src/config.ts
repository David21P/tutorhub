import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: required('DATABASE_URL', 'postgres://tutor:tutor@localhost:5432/tutordb'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: required('JWT_SECRET', nodeEnv === 'production' ? undefined : 'dev-secret-no-usar-en-produccion'),
  // Duración configurable del JWT (ej. 15m, 2h, 1d)
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  frontendOrigins: (process.env.FRONTEND_URL ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  timezone: process.env.APP_TIMEZONE ?? 'America/Guatemala',
  osrmUrl: (process.env.OSRM_URL ?? 'https://router.project-osrm.org').replace(/\/$/, ''),
  travelRoundTrip: process.env.TRAVEL_ROUND_TRIP === 'true',
  enableDevLogin: process.env.ENABLE_DEV_LOGIN === 'true',
};

if (config.isProduction && config.enableDevLogin) {
  throw new Error('ENABLE_DEV_LOGIN no puede estar activo en producción');
}
if (config.isProduction && config.jwtSecret.startsWith('dev-secret')) {
  throw new Error('JWT_SECRET debe definirse en producción');
}

export type AppConfig = typeof config;
