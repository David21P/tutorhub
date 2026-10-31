import { DateTime } from 'luxon';
import { Modality } from '../types';

export const TZ = (import.meta.env.VITE_TIMEZONE as string | undefined) ?? 'America/Guatemala';

export const money = (n: number): string => `Q${n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const dt = (iso: string): DateTime => DateTime.fromISO(iso, { setZone: false }).setZone(TZ).setLocale('es');

export const fmtDateTime = (iso: string): string => dt(iso).toFormat("ccc d LLL yyyy, HH:mm");
export const fmtDate = (iso: string): string => dt(iso).toFormat('d LLL yyyy');
export const fmtTime = (iso: string): string => dt(iso).toFormat('HH:mm');
export const fmtShort = (iso: string): string => dt(iso).toFormat('d LLL, HH:mm');

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const minutesToLabel = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const MODALITY_LABEL: Record<Modality, string> = {
  virtual: 'Virtual',
  tutor_home: 'En casa del tutor',
  student_home: 'En mi domicilio',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
  completed: 'Cumplida',
  active: 'Activa',
  finished: 'Finalizada',
  open: 'Abierto',
  resolved: 'Resuelto',
  dismissed: 'Desestimado',
  accepted: 'Aceptada',
};

export const REASON_LABEL: Record<string, string> = {
  inasistencia: 'Inasistencia',
  conducta_inapropiada: 'Conducta inapropiada',
  cobros_indebidos: 'Cobros indebidos',
  otro: 'Otro',
};

/** Enlace "compartir por WhatsApp" con el resumen de una tutoría. */
export function whatsappShareUrl(text: string, phone?: string | null): string {
  const digits = phone?.replace(/\D/g, '');
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

export const kmLabel = (km: number | null | undefined): string => (km === null || km === undefined ? '—' : `${km.toFixed(1)} km`);
