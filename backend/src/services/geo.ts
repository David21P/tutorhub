import { config } from '../config';
import { round2 } from '../utils/http';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  /** Distancia por carretera en kilómetros (o estimada si el servicio de rutas no responde) */
  distance_km: number;
  duration_min: number | null;
  /** Trayectoria como pares [lat, lng] lista para dibujar en Leaflet */
  geometry: [number, number][];
  source: 'osrm' | 'estimate';
}

const EARTH_RADIUS_KM = 6371;
/** Factor aproximado para pasar de línea recta a distancia por carretera cuando no hay OSRM */
const ROAD_FACTOR = 1.3;

/** Distancia en línea recta (fórmula de Haversine) en kilómetros. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface OsrmResponse {
  code: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  }[];
}

function simplify(points: [number, number][], max = 400): [number, number][] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const result = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (last && result[result.length - 1] !== last) result.push(last);
  return result;
}

/**
 * Calcula la ruta real entre dos puntos con OSRM (OpenStreetMap).
 * Si el servicio no responde, devuelve una estimación en línea recta para no bloquear la reserva.
 */
export async function getRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  const url =
    `${config.osrmUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=geojson';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) {
      const data = (await response.json()) as OsrmResponse;
      const route = data.routes?.[0];
      if (data.code === 'Ok' && route) {
        return {
          distance_km: round2(route.distance / 1000),
          duration_min: Math.round(route.duration / 60),
          geometry: simplify(route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])),
          source: 'osrm',
        };
      }
    }
  } catch {
    // se usa la estimación
  }
  const straight = haversineKm(from, to);
  return {
    distance_km: round2(straight * ROAD_FACTOR),
    duration_min: null,
    geometry: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    source: 'estimate',
  };
}
