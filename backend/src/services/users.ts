import { queryOne, query } from '../db/pool';
import { notFound } from '../utils/http';

export interface TutorProfile {
  bio: string;
  hourly_rate: number;
  cv_file_id: string | null;
  portfolio_url: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  approval_note: string | null;
  rating_avg: number;
  rating_count: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  photo_url: string | null;
  role: 'student' | 'tutor' | 'admin' | null;
  onboarded: boolean;
  status: 'active' | 'suspended';
  suspended_reason: string | null;
  suspended_at: Date | null;
  phone: string | null;
  gender: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  id_document_number: string | null;
  id_document_file_id: string | null;
  category_ids: number[];
  tutor: TutorProfile | null;
}

/** Perfil completo del usuario autenticado (lo que consume el frontend tras iniciar sesión). */
export async function loadUserProfile(userId: string): Promise<UserProfile> {
  const user = await queryOne<Omit<UserProfile, 'category_ids' | 'tutor'>>(
    `SELECT id, email, name, photo_url, role, onboarded, status, suspended_reason, suspended_at,
            phone, gender, address, lat, lng, id_document_number, id_document_file_id
       FROM users WHERE id = $1`,
    [userId],
  );
  if (!user) throw notFound('Usuario no encontrado.');
  const categories = await query<{ category_id: number }>(
    'SELECT category_id FROM user_categories WHERE user_id = $1 ORDER BY category_id',
    [userId],
  );
  const tutor = await queryOne<TutorProfile>(
    `SELECT bio, hourly_rate, cv_file_id, portfolio_url, approval_status, approval_note, rating_avg, rating_count
       FROM tutor_profiles WHERE user_id = $1`,
    [userId],
  );
  return { ...user, category_ids: categories.map((c) => c.category_id), tutor };
}
