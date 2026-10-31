import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { HttpError, unauthorized } from '../utils/http';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

let client: OAuth2Client | null = null;

/**
 * Verifica el token de identidad (ID token) que entrega Google Sign-In y extrae
 * nombre, correo y fotografía de perfil.
 */
export async function verifyGoogleCredential(credential: string): Promise<GoogleProfile> {
  if (!config.googleClientId) {
    throw new HttpError(500, 'GOOGLE_CLIENT_ID no está configurado en el servidor.', 'GOOGLE_NOT_CONFIGURED');
  }
  client ??= new OAuth2Client(config.googleClientId);
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error('Token sin datos de perfil');
    if (payload.email_verified === false) throw new Error('Correo no verificado');
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email.split('@')[0] ?? 'Usuario',
      picture: payload.picture ?? null,
    };
  } catch {
    throw unauthorized('No se pudo verificar la cuenta de Google.', 'GOOGLE_TOKEN_INVALID');
  }
}
