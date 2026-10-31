import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query, queryOne } from '../db/pool';
import { me } from '../middleware/auth';
import { badRequest, forbidden, handler, notFound, paramId, parse } from '../utils/http';

export const filesRouter = Router();

const MAX_BYTES = 3 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];

/** Sube la hoja de vida (cv) o el documento de identificación (identity). Máximo 3 MB. */
filesRouter.post(
  '/',
  upload.single('file'),
  handler(async (req, res) => {
    const user = me(req);
    const { kind } = parse(z.object({ kind: z.enum(['cv', 'identity']) }), req.body);
    const file = req.file;
    if (!file) throw badRequest('Adjunte un archivo.');
    if (!ALLOWED_MIME.includes(file.mimetype)) throw badRequest('Formato no permitido. Use PDF, PNG o JPG.');
    if (kind === 'cv' && file.mimetype !== 'application/pdf') throw badRequest('La hoja de vida debe ser un PDF.');
    const saved = await queryOne<{ id: string }>(
      `INSERT INTO files (owner_id, kind, filename, mime, size, data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user.id, kind, file.originalname.slice(0, 200), file.mimetype, file.size, file.buffer],
    );
    res.status(201).json({ id: saved?.id, filename: file.originalname, mime: file.mimetype, size: file.size, kind });
  }),
);

/** Descarga un archivo. El documento de identificación solo lo ven su dueño y los administradores. */
filesRouter.get(
  '/:id',
  handler(async (req, res) => {
    const user = me(req);
    const id = paramId(req);
    const rows = await query<{
      owner_id: string | null;
      kind: string;
      filename: string;
      mime: string;
      data: Buffer;
      tutor_approved: boolean | null;
    }>(
      `SELECT f.owner_id, f.kind, f.filename, f.mime, f.data,
              (tp.approval_status = 'approved') AS tutor_approved
         FROM files f LEFT JOIN tutor_profiles tp ON tp.user_id = f.owner_id AND tp.cv_file_id = f.id
        WHERE f.id = $1`,
      [id],
    );
    const file = rows[0];
    if (!file) throw notFound('Archivo no encontrado.');
    const allowed =
      file.owner_id === user.id ||
      user.role === 'admin' ||
      (file.kind === 'cv' && file.tutor_approved === true);
    if (!allowed) throw forbidden('No tiene acceso a este archivo.');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.send(file.data);
  }),
);
