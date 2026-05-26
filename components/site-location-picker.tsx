'use client';

import mapboxgl from 'mapbox-gl';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authFetch } from '@/lib/auth/client-session';
import type { SiteGeofenceType } from '@prisma/client';
import type { GeocodingSearchResponse, GeocodingSuggestion, SiteGeofencePolygon } from '@/types/projects';

type SiteLocationPickerProps = Readonly<{
  address: string;
  latitude: string;
  longitude: string;
  radiusKm: number | string;
  geofenceType?: SiteGeofenceType;
  geofencePolygon?: SiteGeofencePolygon | null;
  onChange: (values: Partial<{
    address: string;
    latitude: string;
    longitude: string;
    geofenceType: SiteGeofenceType;
    geofencePolygon: SiteGeofencePolygon | null;
  }>) => void;
  compact?: boolean;
}>;

const DEFAULT_CENTER = {
  latitude: 7.539989,
  longitude: -5.54708,
};
const DEFAULT_ZOOM = 6;
const ACTIVE_LOCATION_ZOOM = 14;
const ZERO_POINT_THRESHOLD = 0.01;

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
const GEOFENCE_SOURCE_ID = 'site-location-picker-geofence';
const GEOFENCE_FILL_ID = 'site-location-picker-geofence-fill';
const GEOFENCE_LINE_ID = 'site-location-picker-geofence-line';

export function SiteLocationPicker({
  address,
  latitude,
  longitude,
  radiusKm,
  geofenceType = 'RADIUS',
  geofencePolygon = null,
  onChange,
  compact = false,
}: SiteLocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [showSearchFeedback, setShowSearchFeedback] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [draftPolygonPoints, setDraftPolygonPoints] = useState<[number, number][]>(() =>
    getOpenPolygonPoints(geofencePolygon),
  );

  const location = useMemo(() => {
    const parsedLatitude = parseCoordinate(latitude);
    const parsedLongitude = parseCoordinate(longitude);

    if (parsedLatitude === null || parsedLongitude === null) {
      return null;
    }

    if (!isUsableSiteCoordinate(parsedLatitude, parsedLongitude)) {
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

  const updateCoordinates = useCallback(
    (nextLatitude: number, nextLongitude: number) => {
      setShowSearchFeedback(false);
      onChange({
        latitude: formatCoordinate(nextLatitude),
        longitude: formatCoordinate(nextLongitude),
      });
    },
    [onChange],
  );

  const suggestionsQuery = useQuery({
    queryKey: ['site-location-picker-geocoding', searchQuery],
    queryFn: async () => {
      const response = await authFetch(`/api/geocoding/search?q=${encodeURIComponent(searchQuery.trim())}`);
      if (!response.ok) {
        throw new Error(`Geocoding request failed with status ${response.status}`);
      }
      return (await response.json()) as GeocodingSearchResponse;
    },
    enabled: searchQuery.trim().length >= 3,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapContainerRef.current || mapRef.current) {
      return;
    }

    setMapError(null);
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const center = location ?? DEFAULT_CENTER;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [center.longitude, center.latitude],
      zoom: location ? ACTIVE_LOCATION_ZOOM : DEFAULT_ZOOM,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const marker = new mapboxgl.Marker({ color: '#ea580c', draggable: true }).setLngLat([
      center.longitude,
      center.latitude,
    ]);

    if (location) {
      marker.addTo(map);
    }

    marker.on('dragend', () => {
      const nextLocation = marker.getLngLat();
      updateCoordinates(nextLocation.lat, nextLocation.lng);
    });

    map.on('click', (event) => {
      if (drawingModeRef.current) {
        const nextPoints = [...draftPolygonPointsRef.current, [event.lngLat.lng, event.lngLat.lat] as [number, number]];
        draftPolygonPointsRef.current = nextPoints;
        setDraftPolygonPoints(nextPoints);
        if (nextPoints.length >= 3) {
          syncPolygonGeofence(map, buildPolygonFromOpenPoints(nextPoints));
        }
        return;
      }

      markerRef.current ??= marker.addTo(map);
      marker.setLngLat(event.lngLat);
      updateCoordinates(event.lngLat.lat, event.lngLat.lng);
    });

    map.on('error', (event) => {
      console.error('Mapbox map error', event.error);
      setMapError(
        "La carte Mapbox n'a pas pu charger les tuiles. Verifiez NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN et les restrictions de domaine.",
      );
    });

    map.on('load', () => {
      mapRef.current = map;
      markerRef.current = location ? marker : null;
      setMapLoaded(true);
      if (geofenceType === 'POLYGON' && geofencePolygon) {
        syncPolygonGeofence(map, geofencePolygon);
      } else if (location) {
        syncCircleGeofence(map, center.latitude, center.longitude, geofenceRadius);
      }
    });

    return () => {
      if (!markerRef.current) {
        marker.remove();
      } else {
        markerRef.current.remove();
      }
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
      setMapError(null);
    };
    // The map must be created once. Later coordinate/radius changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawingModeRef = useRef(drawingMode);
  const draftPolygonPointsRef = useRef(draftPolygonPoints);

  useEffect(() => {
    drawingModeRef.current = drawingMode;
  }, [drawingMode]);

  useEffect(() => {
    draftPolygonPointsRef.current = draftPolygonPoints;
  }, [draftPolygonPoints]);

  useEffect(() => {
    if (!mapRef.current || !location) {
      return;
    }

    const lngLat: [number, number] = [location.longitude, location.latitude];
    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ color: '#ea580c', draggable: true })
        .setLngLat(lngLat)
        .addTo(mapRef.current);

      markerRef.current.on('dragend', () => {
        const nextLocation = markerRef.current?.getLngLat();
        if (nextLocation) {
          updateCoordinates(nextLocation.lat, nextLocation.lng);
        }
      });
    }

    markerRef.current.setLngLat(lngLat);
    mapRef.current.easeTo({ center: lngLat, zoom: Math.max(mapRef.current.getZoom(), ACTIVE_LOCATION_ZOOM), duration: 500 });
  }, [location, updateCoordinates]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !location) {
      return;
    }

    if (drawingMode) {
      if (draftPolygonPoints.length >= 3) {
        syncPolygonGeofence(mapRef.current, buildPolygonFromOpenPoints(draftPolygonPoints));
      }
      return;
    }

    if (geofenceType === 'POLYGON' && geofencePolygon) {
      syncPolygonGeofence(mapRef.current, geofencePolygon);
      return;
    }

    syncCircleGeofence(mapRef.current, location.latitude, location.longitude, geofenceRadius);
  }, [draftPolygonPoints, drawingMode, geofencePolygon, geofenceRadius, geofenceType, location, mapLoaded]);

  useEffect(() => {
    if (!mapRef.current || location) {
      return;
    }

    markerRef.current?.remove();
    markerRef.current = null;
    if (geofenceType !== 'POLYGON') {
      removeGeofence(mapRef.current);
    }
  }, [geofenceType, location]);

  useEffect(() => {
    if (!drawingMode) {
      setDraftPolygonPoints(getOpenPolygonPoints(geofencePolygon));
    }
  }, [drawingMode, geofencePolygon]);

  function selectSuggestion(suggestion: GeocodingSuggestion) {
    setShowSearchFeedback(false);
    setSearchQuery(suggestion.label);
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

  function startDrawingPolygon() {
    const initialPoints = getOpenPolygonPoints(geofencePolygon);
    draftPolygonPointsRef.current = initialPoints;
    setDraftPolygonPoints(initialPoints);
    setDrawingMode(true);
  }

  function closePolygon() {
    if (draftPolygonPoints.length < 3) {
      return;
    }

    const polygon = buildPolygonValueFromOpenPoints(draftPolygonPoints);
    onChange({
      geofenceType: 'POLYGON',
      geofencePolygon: polygon,
    });
    setDrawingMode(false);
    if (mapRef.current) {
      syncPolygonGeofence(mapRef.current, polygon);
    }
  }

  function resetPolygon() {
    draftPolygonPointsRef.current = [];
    setDraftPolygonPoints([]);
    setDrawingMode(false);
    onChange({
      geofenceType: 'RADIUS',
      geofencePolygon: null,
    });
    if (mapRef.current) {
      if (location) {
        syncCircleGeofence(mapRef.current, location.latitude, location.longitude, geofenceRadius);
      } else {
        removeGeofence(mapRef.current);
      }
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Coordonnees GPS du chantier</span>
        <p className="text-sm text-slate-600">
          Recherchez un lieu proche pour placer le marqueur, puis ajustez le point exact du chantier sur la carte.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Adresse ou repere du chantier
          </span>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-500"
            onChange={(event) => onChange({ address: event.target.value })}
            placeholder="Ex. pres de l'ecole primaire, quartier Commerce..."
            value={address}
          />
          <span className="block text-xs font-semibold text-slate-500">
            Le repere aide les equipes a identifier le site. Les coordonnees servent au pointage GPS.
          </span>
        </label>

        <div className="relative">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Rechercher un lieu proche
          </span>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-500"
            onChange={(event) => {
              setShowSearchFeedback(true);
              setSearchQuery(event.target.value);
            }}
            placeholder="Ecole, restaurant, station, marche, quartier..."
            value={searchQuery}
          />
          {showSearchFeedback && suggestionsQuery.data?.items.length ? (
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
        {showSearchFeedback && searchQuery.trim().length >= 3 && suggestionsQuery.isFetching ? (
          <p className="text-xs font-semibold text-slate-500">Recherche de lieu en cours...</p>
        ) : null}
        {showSearchFeedback && searchQuery.trim().length >= 3 && suggestionsQuery.isError ? (
          <p className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700">
            Recherche de lieu indisponible. Verifiez MAPBOX_ACCESS_TOKEN cote serveur.
          </p>
        ) : null}
        {showSearchFeedback &&
        searchQuery.trim().length >= 3 &&
        suggestionsQuery.isSuccess &&
        suggestionsQuery.data.error ? (
          <p className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700">
            Recherche de lieu indisponible : verifiez MAPBOX_ACCESS_TOKEN dans Vercel. Vous pouvez quand meme
            placer le point sur la carte.
          </p>
        ) : null}
        {showSearchFeedback &&
        searchQuery.trim().length >= 3 &&
        suggestionsQuery.isSuccess &&
        !suggestionsQuery.data.error &&
        suggestionsQuery.data.items.length === 0 ? (
          <p className="text-xs font-semibold text-slate-500">
            Aucun lieu trouve. Essayez une ville, un quartier, une ecole, une station ou un repere plus precis.
          </p>
        ) : null}

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
            'relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100',
            compact ? 'h-64' : 'h-80',
          ].join(' ')}
        >
          <div ref={mapContainerRef} className="h-full w-full" />
          {mapError ? (
            <div className="absolute inset-x-3 bottom-3 rounded-xl border border-orange-200 bg-white/95 px-3 py-2 text-xs font-semibold text-orange-700 shadow-lg">
              {mapError}
            </div>
          ) : null}
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
        Rayon de pointage affiche : {geofenceRadius.toFixed(1)} km. Le cercle suit le marqueur.
      </p>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Limite précise optionnelle
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {geofenceType === 'POLYGON'
                ? 'Le pointage utilisera la zone polygonale dessinée.'
                : 'Sans limite précise, le pointage utilise le rayon.'}
            </p>
          </div>
          <BadgeLike active={geofenceType === 'POLYGON'}>
            {geofenceType === 'POLYGON' ? 'Limite précise' : 'Pointage par rayon'}
          </BadgeLike>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
            onClick={startDrawingPolygon}
            type="button"
          >
            {drawingMode ? 'Dessin en cours' : 'Dessiner la limite'}
          </button>
          <button
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={draftPolygonPoints.length < 3}
            onClick={closePolygon}
            type="button"
          >
            Fermer la limite
          </button>
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={resetPolygon}
            type="button"
          >
            Recommencer / utiliser le rayon
          </button>
        </div>
        <p className="mt-3 text-xs font-semibold text-slate-500">
          {drawingMode
            ? `Cliquez sur la carte pour poser les points (${draftPolygonPoints.length}/3 minimum).`
            : 'Vous pouvez modifier cette limite à tout moment depuis le formulaire.'}
        </p>
      </div>
    </div>
  );
}

function BadgeLike({ active, children }: Readonly<{ active: boolean; children: ReactNode }>) {
  return (
    <span
      className={[
        'inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]',
        active ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-700',
      ].join(' ')}
    >
      {children}
    </span>
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

function isUsableSiteCoordinate(latitude: number, longitude: number) {
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return false;
  }

  return Math.abs(latitude) > ZERO_POINT_THRESHOLD || Math.abs(longitude) > ZERO_POINT_THRESHOLD;
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

function syncCircleGeofence(map: mapboxgl.Map, latitude: number, longitude: number, radiusKm: number) {
  const feature = buildCircleFeature(latitude, longitude, radiusKm);
  syncPolygonGeofence(map, feature);
}

function syncPolygonGeofence(map: mapboxgl.Map, polygon: SiteGeofencePolygon | GeoJSON.Feature<GeoJSON.Polygon>) {
  const feature: GeoJSON.Feature<GeoJSON.Polygon> =
    'geometry' in polygon
      ? polygon
      : {
          type: 'Feature',
          properties: {},
          geometry: polygon,
        };
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

function removeGeofence(map: mapboxgl.Map) {
  if (map.getLayer(GEOFENCE_FILL_ID)) {
    map.removeLayer(GEOFENCE_FILL_ID);
  }

  if (map.getLayer(GEOFENCE_LINE_ID)) {
    map.removeLayer(GEOFENCE_LINE_ID);
  }

  if (map.getSource(GEOFENCE_SOURCE_ID)) {
    map.removeSource(GEOFENCE_SOURCE_ID);
  }
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

function buildPolygonFromOpenPoints(points: [number, number][]): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: buildPolygonValueFromOpenPoints(points),
  };
}

function buildPolygonValueFromOpenPoints(points: [number, number][]): SiteGeofencePolygon {
  return {
    type: 'Polygon',
    coordinates: [[...points, points[0]!]],
  };
}

function getOpenPolygonPoints(polygon: SiteGeofencePolygon | null): [number, number][] {
  const ring = polygon?.coordinates[0] ?? [];
  if (ring.length < 2) {
    return [];
  }

  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}
