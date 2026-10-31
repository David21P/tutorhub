import { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { config } from '../config';
import { HttpError } from '../utils/http';

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

const CONSTRAINT_MESSAGES: Record<string, { status: number; code: string; message: string }> = {
  bookings_tutor_no_overlap: {
    status: 409,
    code: 'TUTOR_TIME_CONFLICT',
    message: 'El tutor ya tiene una tutoría que se traslapa con ese horario.',
  },
  bookings_student_no_overlap: {
    status: 409,
    code: 'STUDENT_TIME_CONFLICT',
    message: 'Usted ya tiene una tutoría que se traslapa con ese horario.',
  },
  availability_no_overlap: {
    status: 409,
    code: 'AVAILABILITY_OVERLAP',
    message: 'Los bloques de disponibilidad no pueden traslaparse.',
  },
};

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found', code: 'NOT_FOUND', message: 'Ruta no encontrada.' });
}

/** Convierte cualquier error en una respuesta JSON uniforme: { error, code, message, details? }. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code.toLowerCase(), code: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      error: 'upload_error',
      code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
      message: tooBig ? 'El archivo supera el máximo de 3 MB.' : 'No se pudo procesar el archivo.',
    });
    return;
  }
  const pg = err as PgError;
  if (pg && typeof pg.code === 'string') {
    const known = pg.constraint ? CONSTRAINT_MESSAGES[pg.constraint] : undefined;
    if (pg.code === '23P01' && known) {
      res.status(known.status).json({ error: known.code.toLowerCase(), code: known.code, message: known.message });
      return;
    }
    if (pg.code === '23505') {
      res.status(409).json({ error: 'duplicate', code: 'DUPLICATE', message: 'Ya existe un registro con esos datos.' });
      return;
    }
    if (pg.code === '23503' || pg.code === '22P02' || pg.code === '23514') {
      res.status(400).json({ error: 'bad_request', code: 'BAD_REQUEST', message: 'Los datos enviados no son válidos.' });
      return;
    }
  }
  const syntax = err as { type?: string; status?: number };
  if (syntax?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_request', code: 'BAD_REQUEST', message: 'JSON inválido.' });
    return;
  }
  if (!config.isTest) console.error(err);
  res.status(500).json({ error: 'internal', code: 'INTERNAL', message: 'Error interno del servidor.' });
}
