export type Role = 'student' | 'tutor' | 'admin';
export type Modality = 'virtual' | 'tutor_home' | 'student_home';
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';

export const MODALITIES: Modality[] = ['virtual', 'tutor_home', 'student_home'];

/** Usuario autenticado que se adjunta a cada petición protegida. */
export interface AuthUser {
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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
