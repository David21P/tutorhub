import { PriceBreakdown as Breakdown, RouteInfo } from '../types';
import { kmLabel, money } from '../utils/format';

/** Presupuesto desglosado: tarifa base por horas + traslado por km (cuando el tutor va al domicilio). */
export function PriceBreakdown({ b, route, sessions = 1 }: { b: Breakdown; route?: RouteInfo | null; sessions?: number }) {
  return (
    <table className="breakdown">
      <tbody>
        <tr>
          <td>
            Clase: {b.hours} h × {money(b.hourly_rate)}
          </td>
          <td>{money(b.base_amount)}</td>
        </tr>
        {b.distance_km > 0 && (
          <tr>
            <td>
              Distancia por carretera{route?.source === 'estimate' ? ' (estimada)' : ''}
              {route?.duration_min ? ` · ~${route.duration_min} min` : ''}
            </td>
            <td>{kmLabel(b.distance_km)}</td>
          </tr>
        )}
        {b.travel_amount > 0 && (
          <tr>
            <td>
              Traslado: {Number(b.billable_km).toFixed(2)} km × {money(b.km_rate)}
              {b.round_trip ? ' (ida y vuelta)' : ''}
            </td>
            <td>{money(b.travel_amount)}</td>
          </tr>
        )}
        <tr>
          <td>Total por sesión</td>
          <td>{money(b.total_amount)}</td>
        </tr>
        {sessions > 1 && (
          <tr className="total">
            <td>Total ({sessions} sesiones)</td>
            <td>{money(Math.round(b.total_amount * sessions * 100) / 100)}</td>
          </tr>
        )}
        {sessions <= 1 && (
          <tr className="total">
            <td>Total a pagar</td>
            <td>{money(b.total_amount)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
