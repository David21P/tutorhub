import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool';
import { me } from '../middleware/auth';
import { audit } from '../services/audit';
import { loadUserProfile } from '../services/users';
import { badRequest, handler, parse } from '../utils/http';

export const usersRouter = Router();

const tutorSchema = z.object({
  bio: z.string().trim().min(20, 'La biografía debe tener al menos 20 caracteres').max(2000),
  hourly_rate: z.coerce.number().min(0).max(100000),
  cv_file_id: z.string().uuid().nullish(),
  portfolio_url: z.string().trim().url('URL inválida').nullish().or(z.literal('')),
});

const profileSchema = z
  .object({
    role: z.enum(['student', 'tutor']),
    phone: z.string().trim().min(8, 'Teléfono inválido').max(20),
    gender: z.enum(['masculino', 'femenino', 'otro', 'prefiero_no_decir']),
    address: z.string().trim().min(5, 'Ingrese su dirección').max(300),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    id_document_number: z.string().trim().min(5, 'Documento inválido').max(30),
    id_document_file_id: z.string().uuid().nullish(),
    category_ids: z.array(z.coerce.number().int()).min(1, 'Seleccione al menos una categoría'),
    tutor: tutorSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role !== 'tutor') return;
    if (!data.tutor) {
      ctx.addIssue({ code: 'custom', path: ['tutor'], message: 'Los tutores deben completar sus credenciales' });
      return;
    }
    if (!data.tutor.cv_file_id && !data.tutor.portfolio_url) {
      ctx.addIssue({
        code: 'custom',
        path: ['tutor', 'cv_file_id'],
        message: 'Suba su hoja de vida en PDF o indique la URL de su portafolio',
      });
    }
  });

type ProfileInput = z.infer<typeof profileSchema>;

async function assertFileOwnership(fileId: string | null | undefined, userId: string, kinds: string[]): Promise<void> {
  if (!fileId) return;
  const file = await queryOne<{ owner_id: string | null; kind: string }>(
    'SELECT owner_id, kind FROM files WHERE id = $1',
    [fileId],
  );
  if (!file || file.owner_id !== userId || !kinds.includes(file.kind)) {
    throw badRequest('El archivo adjunto no es válido.');
  }
}

async function saveProfile(userId: string, currentRole: string | null, input: ProfileInput): Promise<void> {
  await assertFileOwnership(input.id_document_file_id, userId, ['identity']);
  await assertFileOwnership(input.tutor?.cv_file_id, userId, ['cv']);

  const valid = await query<{ id: number }>(
    'SELECT id FROM categories WHERE id = ANY($1) AND active',
    [input.category_ids],
  );
  if (valid.length !== new Set(input.category_ids).size) {
    throw badRequest('Alguna de las categorías seleccionadas no existe.');
  }

  await withTransaction(async (client) => {
    await query(
      `UPDATE users SET role = COALESCE(role, $2), onboarded = true, phone = $3, gender = $4, address = $5,
              lat = $6, lng = $7, id_document_number = $8, id_document_file_id = $9
        WHERE id = $1`,
      [
        userId,
        input.role,
        input.phone,
        input.gender,
        input.address,
        input.lat,
        input.lng,
        input.id_document_number,
        input.id_document_file_id ?? null,
      ],
      client,
    );
    await query('DELETE FROM user_categories WHERE user_id = $1', [userId], client);
    for (const categoryId of new Set(input.category_ids)) {
      await query('INSERT INTO user_categories (user_id, category_id) VALUES ($1, $2)', [userId, categoryId], client);
    }
    if ((currentRole ?? input.role) === 'tutor' && input.tutor) {
      await query(
        `INSERT INTO tutor_profiles (user_id, bio, hourly_rate, cv_file_id, portfolio_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, hourly_rate = EXCLUDED.hourly_rate,
           cv_file_id = EXCLUDED.cv_file_id, portfolio_url = EXCLUDED.portfolio_url`,
        [userId, input.tutor.bio, input.tutor.hourly_rate, input.tutor.cv_file_id ?? null, input.tutor.portfolio_url || null],
        client,
      );
    }
    await audit(userId, currentRole ? 'profile.updated' : 'profile.onboarded', 'user', userId, { role: input.role }, client);
  });
}

/** Onboarding obligatorio la primera vez: rol, datos de contacto, ubicación, documento y categorías. */
usersRouter.put(
  '/me/onboarding',
  handler(async (req, res) => {
    const user = me(req);
    if (user.role === 'admin') throw badRequest('Los administradores no necesitan completar el onboarding.');
    if (user.onboarded) throw badRequest('Su perfil ya fue completado. Use la edición de perfil.');
    const input = parse(profileSchema, req.body);
    await saveProfile(user.id, user.role, input);
    res.json({ user: await loadUserProfile(user.id) });
  }),
);

/** Edición posterior del perfil (el rol no se puede cambiar). */
usersRouter.put(
  '/me',
  handler(async (req, res) => {
    const user = me(req);
    if (!user.onboarded || !user.role || user.role === 'admin') throw badRequest('Perfil no editable.');
    const input = parse(profileSchema, req.body);
    if (input.role !== user.role) throw badRequest('No puede cambiar su rol.');
    await saveProfile(user.id, user.role, input);
    res.json({ user: await loadUserProfile(user.id) });
  }),
);
