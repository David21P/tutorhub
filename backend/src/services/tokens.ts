import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export interface TokenPayload extends JwtPayload {
  sub: string;
}

/** Emite el JWT de sesión. La duración se configura con JWT_EXPIRES_IN. */
export function signToken(userId: string): string {
  const options: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign({}, config.jwtSecret, { ...options, subject: userId });
}

export function verifyToken(token: string): TokenPayload {
  const payload = jwt.verify(token, config.jwtSecret);
  if (typeof payload === 'string' || !payload.sub) {
    throw new jwt.JsonWebTokenError('payload inválido');
  }
  return payload as TokenPayload;
}

export { TokenExpiredError } from 'jsonwebtoken';
