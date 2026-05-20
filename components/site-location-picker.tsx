'use client';

import mapboxgl from 'mapbox-gl';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/auth/client-session';
import type { GeocodingSearchResponse, GeocodingSuggestion } from '@/types/projects';

type SiteLocationPickerProps = Readonly<{
  address: string;
  latitude: string;
  longitude: string;
  radiusKm: number | string;
  onChange: (values: Partial<{ address: string; latitude: string; longitude: string }>) => void;
  compact?: boolean;
}>;

const DEFAULT_CENTER = {
  latitude: 5.3600,
  longitude: -4.0083,
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
const GEOFENCE_SOURCE_ID = 'site-location-picker-geofence';
const GEOFENCE_FILL_ID = 'site-location-picker-geofence-fill';
const GEOFENCE_LINE_ID = 'site-location-picker-geofence-line';

export function SiteLocationPicker({
  address,
  latitude,
  longitude,
  radiusKm,
  onChange,
  compact = false,
}: SiteLocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [addressQuery, setAddressQuery] = useState(address);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const location = useMemo(() => {
    const parsedLatitude = parseCoordinate(latitude);
    const parsedLongitude = parseCoordinate(longitude);

    if (parsedLatitude === null || parsedLongitude === null) {
      return null;
    }

    if (!isValidLatitude(parsedLatitude) || !isValidLongitude(parsedLongitude)) {
      return null;
    }

    return {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
    };
  }, [latitude, longitude]);

  const geofenceRadius = useMemo(() => {
    const parsed = Number(radiusKm);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  }, [radiusKm]);

  const suggestionsQuery = useQuery({
    queryKey: ['site-location-picker-geocoding', addressQuery],
    queryFn: async () => {
      const response = await authFetch(`/api/geocoding/search?q=${encodeURIComponent(addressQuery.trim())}`);
      if (!response.ok) {
        throw new Error(`Geocoding request failed with status ${response.status}`);
      }
      return (await response.json()) as GeocodingSearchResponse;
    },
    enabled: addressQuery.trim().length >= 3,
    staleTime: 60_000,
  });

  useEffect(() => {
    setAddressQuery(address);
  }, [address]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapContainerRef.current || mapRef.current) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const center = location ?? DEFAULT_CENTER;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [center.longitude, center.latitude],
      zoom: location ? 14 : 11,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const marker = new mapboxgl.Marker({ color: '#ea580c', draggable: true })
      .setLngLat([center.longitude, center.latitude])
      .addTo(map);

    marker.on('dragend', () => {
      const nextLocation = marker.getLngLat();
      updateCoordinates(nextLocation.lat, nextLocation.lng);
    });

    map.on('click', (event) => {
      marker.setLngLat(event.lngLat);
      updateCoordinates(event.lngLat.lat, event.lngLat.lng);
    });

    map.on('load', () => {
      mapRef.current = map;
      markerRef.current = marker;
      setMapLoaded(true);
      syncGeofence(map, center.latitude, center.longitude, geofenceRadius);
    });

    return () => {
      marker.remove();
      map.remove();
      markerRef.current = null;
      mapRef.current = null;
      setMapLoaded(false);
    };
    // The map must be created once. Later coordinate/radius changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !location) {
      return;
    }

    const lngLat: [number, number] = [location.longitude, location.latitude];
    markerRef.current.setLngLat(lngLat);
    mapRef.current.easeTo({ center: lngLat, zoom: Math.max(mapRef.current.getZoom(), 14), duration: 500 });
  }, [location]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !location) {
      return;
    }

    syncGeofence(mapRef.current, location.latitude, location.longitude, geofenceRadius);
  }, [geofenceRadius, location, mapLoaded]);

  function updateCoordinates(nextLatitude: number, nextLongitude: number) {
    onChange({
      latitude: formatCoordinate(nextLatitude),
      longitude: formatCoordinate(nextLongitude),
    });
  }

  function selectSuggestion(suggestion: GeocodingSuggestion) {
    setAddressQuery(suggestion.label);
    onChange({
      address: suggestion.label,
      latitude: formatCoordinate(suggestion.latitude),
      longitude: formatCoordinate(suggestion.longitude),
    });
  }

  function useCurrentPosition() {
    setGeoMessage(null);

    if (!navigator.geolocation) {
      setGeoMessage("La geolocalisation n'est pas disponible sur cet appareil.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateCoordinates(position.coords.latitude, position.coords.longitude);
        setGeoMessage('Position actuelle appliquee au chantier.');
      },
      () => {
        setGeoMessage("Impossible d'obtenir votre position actuelle. Verifiez l'autorisation GPS du navigateur.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      },
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Localisation du chantier</span>
        <p className="text-sm text-slate-600">
          Recherchez un lieu, ajustez le marqueur sur la carte, ou renseignez les coordonnees manuellement.
        </p>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-500"
            onChange={(event) => {
              setAddressQuery(event.target.value);
              onChange({ address: event.target.value });
            }}
            placeholder="Rechercher une adresse, un quartier, un lieu..."
            value={addressQuery}
          />
          {suggestionsQuery.data?.items.length ? (
            <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              {suggestionsQuery.data.items.map((item) => (
                <button
                  key={`${item.label}:${item.latitude}:${item.longitude}`}
                  className="flex w-full items-start rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                  onClick={() => selectSuggestion(item)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-orange-200 bg-white px-4 text-sm font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-50"
          onClick={useCurrentPosition}
          type="button"
        >
          Utiliser ma position actuelle
        </button>
        {geoMessage ? <p className="text-xs font-semibold text-slate-600">{geoMessage}</p> : null}
      </div>

      {MAPBOX_TOKEN ? (
        <div
          className={[
            'overflow-hidden rounded-2xl border border-slate-200 bg-slate-100',
            compact ? 'h-64' : 'h-80',
          ].join(' ')}
        >
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-orange-300 bg-orange-50 p-4 text-sm font-semibold text-orange-700">
          Carte indisponible : configurez NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN. Les coordonnees manuelles restent
          utilisables.
        </div>
      )}

      <button
        className="text-sm font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 transition hover:text-orange-700"
        onClick={() => setAdvancedOpen((current) => !current)}
        type="button"
      >
        {advancedOpen ? 'Masquer les coordonnees avancees' : 'Coordonnees avancees'}
      </button>

      {advancedOpen ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Latitude</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-500"
              inputMode="decimal"
              onChange={(event) => onChange({ latitude: event.target.value })}
              placeholder="5.348000"
              value={latitude}
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Longitude</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-500"
              inputMode="decimal"
              onChange={(event) => onChange({ longitude: event.target.value })}
              placeholder="-4.008300"
              value={longitude}
            />
          </label>
        </div>
      ) : null}

      <p className="text-xs font-semibold text-slate-500">
        Rayon de geofencing affiche : {geofenceRadius.toFixed(1)} km. Le cercle suit le marqueur.
      </p>
    </div>
  );
}

function parseCoordinate(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidLatitude(value: number) {
  return value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return value >= -180 && value <= 180;
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

function syncGeofence(map: mapboxgl.Map, latitude: number, longitude: number, radiusKm: number) {
  const feature = buildCircleFeature(latitude, longitude, radiusKm);
  const source: mapboxgl.GeoJSONSource | undefined = map.getSource(GEOFENCE_SOURCE_ID);

  if (source) {
    source.setData(feature);
    return;
  }

  map.addSource(GEOFENCE_SOURCE_ID, {
    type: 'geojson',
    data: feature,
  });
  map.addLayer({
    id: GEOFENCE_FILL_ID,
    type: 'fill',
    source: GEOFENCE_SOURCE_ID,
    paint: {
      'fill-color': '#ea580c',
      'fill-opacity': 0.12,
    },
  });
  map.addLayer({
    id: GEOFENCE_LINE_ID,
    type: 'line',
    source: GEOFENCE_SOURCE_ID,
    paint: {
      'line-color': '#ea580c',
      'line-width': 2,
    },
  });
}

function buildCircleFeature(latitude: number, longitude: number, radiusKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const steps = 80;
  const coordinates: [number, number][] = [];
  const latitudeRadius = radiusKm / 110.574;
  const longitudeRadius = radiusKm / (111.32 * Math.cos((latitude * Math.PI) / 180));

  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    coordinates.push([
      longitude + longitudeRadius * Math.cos(angle),
      latitude + latitudeRadius * Math.sin(angle),
    ]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}
