import { config } from '../config';
import { Modality } from '../types';
import { round2 } from '../utils/http';

export interface PriceBreakdown {
  minutes: number;
  hours: number;
  hourly_rate: number;
  base_amount: number;
  distance_km: number;
  km_rate: number;
  /** true si el traslado se cobra ida y vuelta (variable TRAVEL_ROUND_TRIP) */
  round_trip: boolean;
  billable_km: number;
  travel_amount: number;
  total_amount: number;
}

/**
 * Presupuesto de una sesión:
 *   base    = tarifa por hora × horas
 *   traslado = tarifa por km × distancia (solo si el tutor se traslada al domicilio del estudiante)
 */
export function computePrice(input: {
  hourlyRate: number;
  kmRate: number;
  minutes: number;
  modality: Modality;
  distanceKm: number;
}): PriceBreakdown {
  const hours = input.minutes / 60;
  const base = round2(input.hourlyRate * hours);
  const travels = input.modality === 'student_home';
  const billableKm = travels ? round2(input.distanceKm * (config.travelRoundTrip ? 2 : 1)) : 0;
  const travel = travels ? round2(billableKm * input.kmRate) : 0;
  return {
    minutes: input.minutes,
    hours: round2(hours),
    hourly_rate: input.hourlyRate,
    base_amount: base,
    distance_km: round2(input.distanceKm),
    km_rate: travels ? input.kmRate : 0,
    round_trip: travels && config.travelRoundTrip,
    billable_km: billableKm,
    travel_amount: travel,
    total_amount: round2(base + travel),
  };
}
