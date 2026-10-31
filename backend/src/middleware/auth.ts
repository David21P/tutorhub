import { NextFunction, Request, Response } from 'express';
import { JsonWebTokenError } from 'jsonwebtoken';
import { queryOne } from '../db/pool';
import { TokenExpiredError, verifyToken } from '../services/tokens';
import { AuthUser, Role } from '../types';
import { forbidden, handler, unauthorized } from '../utils/http';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role | null;
  onboarded: boolean;
  status: 'active' | 'suspended';
  lat: number | null;
  lng: number | null;
  address: string | null;
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Carga el usuario de un JWT. Lanza HttpError 401 si el token falta, es inválido o expiró. */
export async function userFromToken(token: string | null): Promise<AuthUser> {
  if (!token) throw unauthorized('Se requiere un token de autenticación.', 'TOKEN_REQUIRED');
  let userId: string;
  try {
    userId = verifyToken(token).sub;
  } catch (err) {
    if (err instanceof TokenExpiredError) throw unauthorized('La sesión expiró. Inicie sesión de nuevo.', 'TOKEN_EXPIRED');
    if (err instanceof JsonWebTokenError) throw unauthorized('Token inválido.', 'TOKEN_INVALID');
    throw err;
  }
  const user = await queryOne<UserRow>(
    'SELECT id, email, name, role, onboarded, status, lat, lng, address FROM users WHERE id = $1',
    [userId],
  );
  if (!user) throw unauthorized('El usuario del token ya no existe.', 'TOKEN_INVALID');
  return user;
}

/** Toda petición protegida debe incluir el header Authorization: Bearer <JWT>. */
export const authenticate = handler(async (req: Request, _res: Response, next: NextFunction) => {
  req.user = await userFromToken(extractBearer(req.headers.authorization));
  next();
});

/** Una cuenta suspendida puede iniciar sesión pero no usar el resto de la API. */
export function activeOnly(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.status === 'suspended') {
    next(forbidden('Su cuenta está suspendida.', 'ACCOUNT_SUSPENDED'));
    return;
  }
  next();
}

export function requireOnboarded(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.onboarded) {
    next(forbidden('Debe completar su perfil antes de continuar.', 'ONBOARDING_REQUIRED'));
    return;
  }
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user?.role || !roles.includes(req.user.role)) {
      next(forbidden('No tiene permisos para esta acción.', 'ROLE_FORBIDDEN'));
      return;
    }
    next();
  };

/** Usuario autenticado de la petición (los middlewares anteriores garantizan que existe). */
export function me(req: Request): AuthUser {
  if (!req.user) throw unauthorized('Se requiere un token de autenticación.', 'TOKEN_REQUIRED');
  return req.user;
}
