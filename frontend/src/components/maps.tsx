import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useEffect, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { RouteInfo } from '../types';

// Los íconos por defecto de Leaflet no se resuelven solos con Vite
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

const GUATEMALA: [number, number] = [14.6349, -90.5069];
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const studentIcon = L.divIcon({ className: '', html: '<div style="font-size:26px;line-height:1">📍</div>', iconSize: [26, 26], iconAnchor: [13, 24] });
const tutorIcon = L.divIcon({ className: '', html: '<div style="font-size:26px;line-height:1">🎓</div>', iconSize: [26, 26], iconAnchor: [13, 24] });

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Recenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom ?? map.getZoom());
  }, [center[0], center[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

interface PickerProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number, address?: string) => void;
}

/** Selector de ubicación: clic en el mapa, búsqueda de dirección (OpenStreetMap/Nominatim) o geolocalización. */
export function LocationPicker({ lat, lng, onChange }: PickerProps) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const center: [number, number] = lat !== null && lng !== null ? [lat, lng] : GUATEMALA;

  const geocode = async () => {
    if (search.trim().length < 3) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(search)}`, {
        headers: { 'Accept-Language': 'es' },
      });
      const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      const hit = data[0];
      if (!hit) setMsg('No se encontró esa dirección. Marque el punto directamente en el mapa.');
      else onChange(parseFloat(hit.lat), parseFloat(hit.lon), hit.display_name);
    } catch {
      setMsg('No se pudo buscar la dirección. Marque el punto en el mapa.');
    } finally {
      setBusy(false);
    }
  };

  const locate = () => {
    if (!navigator.geolocation) return setMsg('Su navegador no soporta geolocalización.');
    navigator.geolocation.getCurrentPosition(
      (pos) => onChange(pos.coords.latitude, pos.coords.longitude),
      () => setMsg('No se pudo obtener su ubicación. Marque el punto en el mapa.'),
    );
  };

  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <div className="row">
        <input
          type="search"
          placeholder="Buscar dirección (ej. Zona 10, Guatemala)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void geocode();
            }
          }}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void geocode()} disabled={busy}>
          Buscar
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={locate}>
          Mi ubicación
        </button>
      </div>
      {msg && <span className="field__error">{msg}</span>}
      <MapContainer center={center} zoom={lat !== null ? 14 : 12} className="map" scrollWheelZoom={false}>
        <TileLayer url={TILES} attribution={ATTRIBUTION} />
        <ClickHandler onPick={(la, ln) => onChange(la, ln)} />
        {lat !== null && lng !== null && (
          <>
            <Marker position={[lat, lng]} icon={studentIcon} />
            <Recenter center={[lat, lng]} />
          </>
        )}
      </MapContainer>
      <span className="field__hint">
        {lat !== null && lng !== null ? `Coordenadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Haga clic en el mapa para marcar su ubicación.'}
      </span>
    </div>
  );
}

function FitRoute({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    else if (points.length === 1 && points[0]) map.setView(points[0], 14);
  }, [map, points]);
  return null;
}

interface RouteMapProps {
  tutor: { lat: number; lng: number; label?: string } | null;
  student: { lat: number; lng: number; label?: string } | null;
  route?: RouteInfo | null;
  large?: boolean;
}

/** Mapa con la ruta real tutor ⇄ estudiante, calculada con OSRM sobre datos de OpenStreetMap. */
export function RouteMap({ tutor, student, route, large }: RouteMapProps) {
  const points: [number, number][] = route?.geometry?.length
    ? route.geometry
    : ([tutor, student].filter(Boolean).map((p) => [(p as { lat: number }).lat, (p as { lng: number }).lng]) as [number, number][]);
  const center = points[0] ?? GUATEMALA;
  return (
    <MapContainer center={center} zoom={13} className={`map${large ? ' map--lg' : ''}`} scrollWheelZoom={false}>
      <TileLayer url={TILES} attribution={ATTRIBUTION} />
      {tutor && (
        <Marker position={[tutor.lat, tutor.lng]} icon={tutorIcon}>
          <Popup>{tutor.label ?? 'Tutor'}</Popup>
        </Marker>
      )}
      {student && (
        <Marker position={[student.lat, student.lng]} icon={studentIcon}>
          <Popup>{student.label ?? 'Estudiante'}</Popup>
        </Marker>
      )}
      {route && route.geometry.length > 1 && <Polyline positions={route.geometry} pathOptions={{ color: '#4f46e5', weight: 5, opacity: 0.85 }} />}
      <FitRoute points={points} />
    </MapContainer>
  );
}

interface ResultsMapProps {
  me: { lat: number; lng: number } | null;
  tutors: { id: string; name: string; lat: number | null; lng: number | null }[];
  onOpen: (id: string) => void;
}

/** Mapa con la ubicación de los tutores encontrados. */
export function ResultsMap({ me, tutors, onOpen }: ResultsMapProps) {
  const points: [number, number][] = tutors.filter((t) => t.lat !== null && t.lng !== null).map((t) => [t.lat as number, t.lng as number]);
  if (me) points.push([me.lat, me.lng]);
  return (
    <MapContainer center={points[0] ?? GUATEMALA} zoom={11} className="map" scrollWheelZoom={false}>
      <TileLayer url={TILES} attribution={ATTRIBUTION} />
      {me && <Marker position={[me.lat, me.lng]} icon={studentIcon}><Popup>Usted está aquí</Popup></Marker>}
      {tutors.map(
        (t) =>
          t.lat !== null &&
          t.lng !== null && (
            <Marker key={t.id} position={[t.lat, t.lng]} icon={tutorIcon} eventHandlers={{ click: () => onOpen(t.id) }}>
              <Popup>{t.name}</Popup>
            </Marker>
          ),
      )}
      <FitRoute points={points} />
    </MapContainer>
  );
}
