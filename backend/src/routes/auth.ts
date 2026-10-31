import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { queryOne } from '../db/pool';
import { authenticate, me } from '../middleware/auth';
import { audit } from '../services/audit';
import { GoogleProfile, verifyGoogleCredential } from '../services/google';
import { signToken } from '../services/tokens';
import { loadUserProfile } from '../services/users';
import { handler, notFound, parse } from '../utils/http';

export const authRouter = Router();

/**
 * Crea el usuario la primera vez que inicia sesión o actualiza su nombre y foto.
 * Los correos listados en ADMIN_EMAILS reciben el rol de administrador.
 */
async function upsertUser(profile: GoogleProfile): Promise<string> {
  const isAdmin = config.adminEmails.includes(profile.email.toLowerCase());
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE google_sub = $1 OR lower(email) = lower($2) LIMIT 1',
    [profile.sub, profile.email],
  );
  if (existing) {
    await queryOne(
      `UPDATE users SET google_sub = COALESCE(google_sub, $2), name = COALESCE($3, name), photo_url = COALESCE($4, photo_url),
              role = CASE WHEN $5 THEN 'admin' ELSE role END,
              onboarded = CASE WHEN $5 THEN true ELSE onboarded END
        WHERE id = $1`,
      [existing.id, profile.sub, profile.name, profile.picture, isAdmin],
    );
    return existing.id;
  }
  const created = await queryOne<{ id: string }>(
    `INSERT INTO users (google_sub, email, name, photo_url, role, onboarded)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [profile.sub, profile.email, profile.name ?? profile.email.split('@')[0] ?? 'Usuario', profile.picture, isAdmin ? 'admin' : null, isAdmin],
  );
  if (!created) throw new Error('No se pudo crear el usuario');
  await audit(created.id, 'user.created', 'user', created.id, { email: profile.email });
  return created.id;
}

/** Flujo OAuth 2.0: recibe el ID token de Google, lo verifica y emite el JWT de sesión. */
authRouter.post(
  '/google',
  handler(async (req, res) => {
    const { credential } = parse(z.object({ credential: z.string().min(10) }), req.body);
    const profile = await verifyGoogleCredential(credential);
    const userId = await upsertUser(profile);
    res.json({ token: signToken(userId), user: await loadUserProfile(userId) });
  }),
);

/** Solo para desarrollo y pruebas: permite entrar sin Google. Se desactiva en producción. */
authRouter.post(
  '/dev-login',
  handler(async (req, res) => {
    if (!config.enableDevLogin) throw notFound();
    const body = parse(
      z.object({ email: z.string().email(), name: z.string().min(1).max(100).optional() }),
      req.body,
    );
    const profile: GoogleProfile = {
      sub: `dev:${body.email.toLowerCase()}`,
      email: body.email,
      name: body.name ?? null,
      picture: null,
    };
    const userId = await upsertUser(profile);
    res.json({ token: signToken(userId), user: await loadUserProfile(userId) });
  }),
);

/** Usuario de la sesión actual (disponible también para cuentas suspendidas). */
authRouter.get(
  '/me',
  authenticate,
  handler(async (req, res) => {
    res.json({ user: await loadUserProfile(me(req).id) });
  }),
);
