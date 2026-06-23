'use client';

import mapboxgl from 'mapbox-gl';
import Link from 'next/link';
import { SiteStatus } from '@prisma/client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/auth/client-session';
import { haversineDistanceKm } from '@/lib/haversine';
import type { SiteMapResponse, SiteMapSiteItem } from '@/types/site-map';

type SiteMapPageProps = Readonly<{
  surface: 'mobile' | 'web';
}>;

type GeoPoint = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
const DEFAULT_CENTER: [number, number] = [-5.54708, 7.539989];
const DEFAULT_ZOOM = 5.8;

const statusFilters: { value: 'ALL' | SiteStatus; label: string }[] = [
  { value: 'ALL', label: 'Tous statuts' },
  { value: SiteStatus.ACTIVE, label: 'Actifs' },
  { value: SiteStatus.ON_HOLD, label: 'En pause' },
  { value: SiteStatus.COMPLETED, label: 'Termines' },
];

export function SiteMapPage({ surface }: SiteMapPageProps) {
  const [projectId, setProjectId] = useState('ALL');
  const [projectManagerId, setProjectManagerId] = useState('ALL');
  const [status, setStatus] = useState<'ALL' | SiteStatus>('ALL');
  const [query, setQuery] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [visitComment, setVisitComment] = useState('');
  const [visitMessage, setVisitMessage] = useState<string | null>(null);
  const [userPosition, setUserPosition] = useState<GeoPoint | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const requestPath = useMemo(() => {
    const params = new URLSearchParams();
    if (projectId !== 'ALL') params.set('projectId', projectId);
    if (projectManagerId !== 'ALL') params.set('projectManagerId', projectManagerId);
    if (status !== 'ALL') params.set('status', status);
    if (query.trim()) params.set('q', query.trim());
    const qs = params.toString();
    return qs ? `/api/site-map?${qs}` : '/api/site-map';
  }, [projectId, projectManagerId, query, status]);

  const siteMapQuery = useQuery({
    queryKey: ['site-map', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath);
      if (!response.ok) {
        throw new Error(`Site map request failed with status ${response.status}`);
      }
      return (await response.json()) as SiteMapResponse;
    },
    staleTime: 30_000,
  });

  const data = siteMapQuery.data;
  const selectedSite = useMemo(
    () => data?.sites.find((site) => site.id === selectedSiteId) ?? data?.sites[0] ?? null,
    [data?.sites, selectedSiteId],
  );
  const canRenderMap = Boolean(MAPBOX_TOKEN);
  const selectedDistanceKm = selectedSite && userPosition
    ? haversineDistanceKm(
        { latitude: userPosition.latitude, longitude: userPosition.longitude },
        { latitude: selectedSite.latitude, longitude: selectedSite.longitude },
      )
    : null;

  useEffect(() => {
    if (!canRenderMap || !mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;
    const markers = markersRef.current;

    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [canRenderMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    if (data.sites.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const site of data.sites) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `site-map-marker site-map-marker-${site.status.toLowerCase()}`;
      element.setAttribute('aria-label', site.name);
      element.addEventListener('click', () => setSelectedSiteId(site.id));

      const marker = new mapboxgl.Marker({ element }).setLngLat([site.longitude, site.latitude]).addTo(map);
      markersRef.current.set(site.id, marker);
      bounds.extend([site.longitude, site.latitude]);
    }

    if (data.sites.length === 1) {
      map.flyTo({ center: [data.sites[0]!.longitude, data.sites[0]!.latitude], zoom: 13, essential: false });
    } else {
      map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 600 });
    }
  }, [data]);

  useEffect(() => {
    if (!selectedSite || !mapRef.current) return;
    mapRef.current.flyTo({ center: [selectedSite.longitude, selectedSite.latitude], zoom: Math.max(mapRef.current.getZoom(), 12), essential: false });
  }, [selectedSite]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPosition) return;

    if (!userMarkerRef.current) {
      const element = document.createElement('div');
      element.className = 'site-map-user-marker';
      element.setAttribute('aria-label', 'Votre position');
      userMarkerRef.current = new mapboxgl.Marker({ element }).setLngLat([userPosition.longitude, userPosition.latitude]).addTo(map);
      return;
    }

    userMarkerRef.current.setLngLat([userPosition.longitude, userPosition.latitude]);
  }, [userPosition]);

  async function handleLocateMe() {
    setLocationLoading(true);
    setLocationError(null);

    const position = await getCurrentPositionOrNull();
    setLocationLoading(false);

    if (!position) {
      setLocationError('Position indisponible. Activez le GPS puis reessayez.');
      return;
    }

    setUserPosition(position);
    mapRef.current?.flyTo({ center: [position.longitude, position.latitude], zoom: 14, essential: false });
  }

  const visitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSite) throw new Error('NO_SITE');
      const geo = await getCurrentPositionOrNull();
      const response = await authFetch('/api/mobile/site-visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: selectedSite.id,
          comment: visitComment.trim() || null,
          latitude: geo?.latitude ?? null,
          longitude: geo?.longitude ?? null,
          accuracy: geo?.accuracy ?? null,
        }),
      });

      if (!response.ok) throw new Error('VISIT_FAILED');
      return (await response.json()) as { visit: { visitedAt: string } };
    },
    onSuccess: (payload) => {
      setVisitMessage(`Visite enregistree a ${formatTime(payload.visit.visitedAt)}.`);
      setVisitComment('');
    },
  });

  return (
    <div className={surface === 'mobile' ? 'space-y-4 pb-20' : 'space-y-6'}>
      <section className={surface === 'mobile' ? 'rounded-lg border border-primary/20 bg-primary/10 p-4' : 'rounded-lg border border-slate-200 bg-white p-5 shadow-sm'}>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Cartographie</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-950">Cartographie des sites</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Sites geolocalises, filtres et acces rapide aux itineraires.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em]">
            <button
              className="rounded-full bg-slate-950 px-3 py-1 text-white disabled:bg-slate-300"
              disabled={locationLoading}
              onClick={() => void handleLocateMe()}
              type="button"
            >
              {locationLoading ? 'Localisation...' : 'Ma position'}
            </button>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{data?.totals.sites ?? 0} site(s)</span>
            {userPosition ? (
              <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">
                GPS {userPosition.accuracy ? `${Math.round(userPosition.accuracy)} m` : 'actif'}
              </span>
            ) : null}
            {(data?.totals.hiddenWithoutCoordinates ?? 0) > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                {data?.totals.hiddenWithoutCoordinates} sans GPS
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {locationError ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
          {locationError}
        </section>
      ) : null}

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-panel md:grid-cols-4">
        <input
          className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-primary"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Projet, chantier, ville, adresse, PM"
          type="search"
          value={query}
        />
        <select className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold" onChange={(event) => setProjectId(event.target.value)} value={projectId}>
          <option value="ALL">Tous les projets</option>
          {data?.filters.projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        {data?.viewer.canFilterProjectManager ? (
          <select className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold" onChange={(event) => setProjectManagerId(event.target.value)} value={projectManagerId}>
            <option value="ALL">Tous les chefs projet</option>
            {data.filters.projectManagers.map((manager) => (
              <option key={manager.id} value={manager.id}>{manager.name}</option>
            ))}
          </select>
        ) : null}
        <select className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold" onChange={(event) => setStatus(event.target.value as 'ALL' | SiteStatus)} value={status}>
          {statusFilters.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </section>

      {siteMapQuery.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          Impossible de charger la cartographie des sites.
        </section>
      ) : null}

      <section className={surface === 'mobile' ? 'space-y-3' : 'grid min-h-[640px] grid-cols-[minmax(0,1fr)_360px] gap-4'}>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-panel">
          {canRenderMap ? (
            <div className={surface === 'mobile' ? 'h-[58vh] min-h-[420px]' : 'h-[640px]'} ref={mapContainerRef} />
          ) : (
            <div className="flex h-80 flex-col items-center justify-center bg-slate-50 p-6 text-center">
              <h2 className="text-lg font-black text-slate-950">Carte indisponible</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                Configurez NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN pour afficher la carte. La liste reste disponible.
              </p>
            </div>
          )}
        </div>

        <aside className="space-y-3">
          {selectedSite ? (
            <SiteDetailsCard
              canLogVisit={Boolean(data?.viewer.canLogVisit)}
              surface={surface}
              comment={visitComment}
              distanceKm={selectedDistanceKm}
              isSavingVisit={visitMutation.isPending}
              onCommentChange={setVisitComment}
              onLogVisit={() => visitMutation.mutate()}
              site={selectedSite}
              visitError={visitMutation.isError}
              visitMessage={visitMessage}
            />
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-panel">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Sites affiches</h2>
            <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {siteMapQuery.isLoading ? <p className="text-sm font-semibold text-slate-500">Chargement...</p> : null}
              {data?.sites.length === 0 && !siteMapQuery.isLoading ? (
                <p className="text-sm font-semibold text-slate-500">Aucun site avec coordonnees valides.</p>
              ) : null}
              {data?.sites.map((site) => (
                <button
                  className={`w-full rounded-lg border p-3 text-left transition ${selectedSite?.id === site.id ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50'}`}
                  key={site.id}
                  onClick={() => setSelectedSiteId(site.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{site.name}</p>
                      <p className="mt-1 truncate text-xs font-bold text-slate-500">{site.project.name}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${statusTone(site.status)}`}>
                      {formatStatus(site.status)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs font-semibold text-slate-500">{site.address}</p>
                  {userPosition ? (
                    <p className="mt-2 text-xs font-black text-primary">
                      {formatDistance(haversineDistanceKm(
                        { latitude: userPosition.latitude, longitude: userPosition.longitude },
                        { latitude: site.latitude, longitude: site.longitude },
                      ))}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <style jsx global>{`
        .site-map-marker {
          width: 18px;
          height: 18px;
          border: 3px solid #fff;
          border-radius: 999px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.25);
          cursor: pointer;
        }
        .site-map-marker-active { background: #10b981; }
        .site-map-marker-on_hold { background: #f59e0b; }
        .site-map-marker-completed { background: #64748b; }
        .site-map-user-marker {
          width: 22px;
          height: 22px;
          border: 4px solid #fff;
          border-radius: 999px;
          background: #2563eb;
          box-shadow: 0 0 0 8px rgba(37, 99, 235, 0.18), 0 8px 18px rgba(15, 23, 42, 0.25);
        }
      `}</style>
    </div>
  );
}

function SiteDetailsCard({
  canLogVisit,
  comment,
  distanceKm,
  isSavingVisit,
  onCommentChange,
  onLogVisit,
  site,
  surface,
  visitError,
  visitMessage,
}: Readonly<{
  canLogVisit: boolean;
  comment: string;
  distanceKm: number | null;
  isSavingVisit: boolean;
  onCommentChange: (value: string) => void;
  onLogVisit: () => void;
  site: SiteMapSiteItem;
  surface: 'mobile' | 'web';
  visitError: boolean;
  visitMessage: string | null;
}>) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`rounded-full px-2 py-1 text-[11px] font-black ${statusTone(site.status)}`}>
            {formatStatus(site.status)}
          </span>
          <h2 className="mt-3 text-lg font-black leading-6 text-slate-950">{site.name}</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">{site.project.name}</p>
        </div>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <InfoRow label="Chef projet" value={site.projectManager.name} />
        <InfoRow label="Ville" value={site.project.city || '-'} />
        <InfoRow label="Adresse" value={site.address || '-'} />
        <InfoRow label="GPS" value={`${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}`} />
        <InfoRow label="Rayon" value={`${site.radiusKm} km`} />
        {distanceKm !== null ? <InfoRow label="Distance" value={formatDistance(distanceKm)} /> : null}
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          className="flex min-h-11 items-center justify-center rounded-lg bg-slate-950 px-3 text-xs font-black text-white"
          href={`https://www.google.com/maps?q=${site.latitude},${site.longitude}`}
          rel="noreferrer"
          target="_blank"
        >
          Ouvrir Maps
        </a>
        <Link
          className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700"
          href={surface === 'mobile' ? `/mobile/sites/${encodeURIComponent(site.id)}` : `/web/projects/${encodeURIComponent(site.project.id)}`}
        >
          Voir details
        </Link>
      </div>
      {canLogVisit ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <textarea
            className="min-h-20 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold outline-none focus:border-primary"
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder="Commentaire optionnel"
            value={comment}
          />
          <button
            className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3 text-sm font-black text-white disabled:bg-slate-300"
            disabled={isSavingVisit}
            onClick={onLogVisit}
            type="button"
          >
            {isSavingVisit ? 'Enregistrement...' : 'Marquer visite'}
          </button>
          {visitError ? <p className="mt-2 text-sm font-bold text-red-600">Visite non enregistree.</p> : null}
          {visitMessage ? <p className="mt-2 text-sm font-bold text-emerald-700">{visitMessage}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function InfoRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
      <dt className="font-black text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function statusTone(status: SiteStatus) {
  switch (status) {
    case SiteStatus.ACTIVE:
      return 'bg-emerald-100 text-emerald-800';
    case SiteStatus.ON_HOLD:
      return 'bg-amber-100 text-amber-800';
    case SiteStatus.COMPLETED:
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function formatStatus(status: SiteStatus) {
  switch (status) {
    case SiteStatus.ACTIVE:
      return 'Actif';
    case SiteStatus.ON_HOLD:
      return 'En pause';
    case SiteStatus.COMPLETED:
      return 'Termine';
    default:
      return status;
  }
}

function formatDistance(distanceKm: number) {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(2)} km`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function getCurrentPositionOrNull(): Promise<GeoPoint | null> {
  if (!navigator.geolocation) return Promise.resolve(null);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
    );
  });
}