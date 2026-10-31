import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodTypeAny, z } from 'zod';

/** Error con código HTTP y código de aplicación, que el manejador de errores convierte en JSON. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg: string, code = 'UNAUTHORIZED') => new HttpError(401, msg, code);
export const forbidden = (msg: string, code = 'FORBIDDEN') => new HttpError(403, msg, code);
export const notFound = (msg = 'Recurso no encontrado') => new HttpError(404, msg, 'NOT_FOUND');
export const conflict = (msg: string, code = 'CONFLICT', details?: unknown) => new HttpError(409, msg, code, details);

/** Permite usar funciones async en los handlers de Express sin try/catch repetidos. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Valida un objeto con un esquema de zod y devuelve el resultado tipado. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      throw badRequest(
        err.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; '),
        err.issues,
      );
    }
    throw err;
  }
}

/** Convierte un parámetro de ruta uuid y valida su formato. */
export const uuidSchema = z.string().uuid('identificador inválido');

export function paramId(req: Request, name = 'id'): string {
  return parse(uuidSchema, req.params[name]);
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
