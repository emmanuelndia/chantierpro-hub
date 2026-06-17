'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Badge } from '@/components/badge';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';

type NegotiationOverview = {
  date: string;
  projects: { id: string; name: string; city: string; status: string }[];
  zones: {
    id: string;
    projectId: string;
    name: string;
    city: string | null;
    region: string | null;
  }[];
  resources: { id: string; name: string; role: string; username: string }[];
  assignments: {
    id: string;
    project: { id: string; name: string; city: string };
    assignee: { id: string; name: string; role: string; username: string };
    plannedZone: string | null;
    instruction: string | null;
    status: string;
    sessionCount: number;
    visitCount: number;
  }[];
  sessions: NegotiationSession[];
  visits: NegotiationVisit[];
  buildingCount: number;
  projectScopeSummaries: {
    projectId: string;
    totalScopes: number;
    authorized: number;
    refused: number;
    revisit: number;
    inProgress: number;
    untreated: number;
    processed: number;
    treatmentRate: number;
    authorizationRate: number;
  }[];
  visitStatuses: string[];
};

type NegotiationSession = {
  id: string;
  project: { id: string; name: string } | null;
  assignment: { id: string; plannedZone: string | null; instruction: string | null } | null;
  user: { id: string; name: string; role: string; username: string } | null;
  startTime: string;
  endTime: string | null;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  status: string;
  visitCount: number;
  comment: string | null;
  visits: { actualZone: string | null; buildingName: string; status: string }[];
};

type NegotiationVisit = {
  id: string;
  project: { id: string; name: string } | null;
  resourceName: string | null;
  visitedAt: string;
  actualZone: string | null;
  buildingName: string;
  city: string | null;
  commune: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  remark: string;
};

const todayKey = new Date().toISOString().slice(0, 10);

export function NegotiationWebPage() {
  const { pushToast } = useToast();
  const [date, setDate] = useState(todayKey);
  const [filters, setFilters] = useState({
    projectId: '',
    resourceId: '',
    status: '',
    actualZone: '',
    q: '',
  });

  const overviewQuery = useQuery({
    queryKey: ['negotiation-overview', date, filters],
    queryFn: () => fetchNegotiationOverview(date, filters),
    refetchInterval: 60_000,
  });
  const overview = overviewQuery.data;
  const projectSummaries = useMemo(
    () => (filters.projectId ? overview?.projectScopeSummaries.filter((summary) => summary.projectId === filters.projectId) : overview?.projectScopeSummaries) ?? [],
    [filters.projectId, overview?.projectScopeSummaries],
  );
  const scopeTotals = useMemo(() => {
    const totalScopes = projectSummaries.reduce((sum, summary) => sum + summary.totalScopes, 0);
    const processed = projectSummaries.reduce((sum, summary) => sum + summary.processed, 0);
    const authorized = projectSummaries.reduce((sum, summary) => sum + summary.authorized, 0);
    const refused = projectSummaries.reduce((sum, summary) => sum + summary.refused, 0);
    const revisit = projectSummaries.reduce((sum, summary) => sum + summary.revisit, 0);
    const untreated = projectSummaries.reduce((sum, summary) => sum + summary.untreated, 0);
    return {
      totalScopes,
      processed,
      authorized,
      refused,
      revisit,
      untreated,
      treatmentRate: totalScopes > 0 ? Math.round((processed / totalScopes) * 100) : 0,
      authorizationRate: totalScopes > 0 ? Math.round((authorized / totalScopes) * 100) : 0,
    };
  }, [projectSummaries]);

  function setFilter(name: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-orange-600">Service negociation</p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-950">Suivi negociation</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              Suis les scopes de negociation par projet, importe les bases a traiter et consolide les resultats terrain.
            </p>
          </div>
          <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Date
            <input className="mt-2 block rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
          </label>
          <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50" onClick={() => void downloadNegotiationExport(date, pushToast)} type="button">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </section>

      {overview ? (
        <>
          <section className="rounded-[2rem] border border-orange-100 bg-orange-50 p-5">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-700">Organisation</p>
            <p className="mt-2 text-sm font-bold leading-6 text-orange-950">
              Les zones de journee se planifient maintenant dans Planning avec le type Zone. Les pointages des negociateurs remontent dans Presences comme du terrain.
              Cette page sert au suivi metier des scopes : autorisations, refus, zones reelles et remarques terrain.
            </p>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Filtres pilotage</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">Lire les zones, sessions et scopes</h2>
              </div>
              <button
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50"
                onClick={() => setFilters({ projectId: '', resourceId: '', status: '', actualZone: '', q: '' })}
                type="button"
              >
                Reinitialiser
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Select label="Projet" value={filters.projectId} onChange={(value) => setFilter('projectId', value)}>
                <option value="">Tous les projets</option>
                {overview.projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </Select>
              <Select label="Ressource" value={filters.resourceId} onChange={(value) => setFilter('resourceId', value)}>
                <option value="">Toutes les ressources</option>
                {overview.resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>{resource.name}</option>
                ))}
              </Select>
              <Select label="Statut scope" value={filters.status} onChange={(value) => setFilter('status', value)}>
                <option value="">Tous les statuts</option>
                {overview.visitStatuses.map((status) => (
                  <option key={status} value={status}>{formatVisitStatus(status)}</option>
                ))}
              </Select>
              <label className="text-sm font-bold text-slate-700">
                Zone reelle
                <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-orange-500" onChange={(event) => setFilter('actualZone', event.target.value)} placeholder="Ex: Bingerville" value={filters.actualZone} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Recherche
                <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-orange-500" onChange={(event) => setFilter('q', event.target.value)} placeholder="Scope, commune, remarque..." value={filters.q} />
              </label>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Total scopes" value={scopeTotals.totalScopes} />
            <Metric label="Traites" value={`${scopeTotals.treatmentRate}%`} />
            <Metric label="Autorisations" value={scopeTotals.authorized} />
            <Metric label="Refus" value={scopeTotals.refused} />
            <Metric label="A revisiter" value={scopeTotals.revisit} />
            <Metric label="Non traites" value={scopeTotals.untreated} />
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
            <h2 className="text-lg font-black text-slate-950">Progression par projet</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Pour créer ou importer les scopes, ouvre le détail du projet concerné.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Projet</th>
                    <th className="px-3 py-3">Total</th>
                    <th className="px-3 py-3">Traites</th>
                    <th className="px-3 py-3">Autorisations</th>
                    <th className="px-3 py-3">Refus</th>
                    <th className="px-3 py-3">A revisiter</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {projectSummaries.map((summary) => {
                    const project = overview.projects.find((item) => item.id === summary.projectId);
                    return (
                      <tr key={summary.projectId}>
                        <td className="max-w-sm px-3 py-3 font-black text-slate-950">{project?.name ?? 'Projet'}</td>
                        <td className="px-3 py-3">{summary.totalScopes}</td>
                        <td className="px-3 py-3">{summary.processed} ({summary.treatmentRate}%)</td>
                        <td className="px-3 py-3 text-emerald-700">{summary.authorized}</td>
                        <td className="px-3 py-3 text-red-700">{summary.refused}</td>
                        <td className="px-3 py-3 text-amber-700">{summary.revisit}</td>
                      </tr>
                    );
                  })}
                  {projectSummaries.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-sm font-bold text-slate-500" colSpan={6}>Aucun scope pour ces filtres.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
            <h2 className="text-lg font-black text-slate-950">Resultats scopes terrain</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Ressource</th>
                    <th className="px-3 py-3">Scope</th>
                    <th className="px-3 py-3">Zone</th>
                    <th className="px-3 py-3">Zone reelle</th>
                    <th className="px-3 py-3">Statut</th>
                    <th className="px-3 py-3">Remarque</th>
                    <th className="px-3 py-3">GPS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.visits.map((visit) => (
                    <tr key={visit.id}>
                      <td className="px-3 py-3 font-bold text-slate-900">{visit.resourceName ?? '-'}</td>
                      <td className="px-3 py-3">{visit.buildingName}</td>
                      <td className="px-3 py-3">{[visit.city, visit.commune].filter(Boolean).join(' / ') || '-'}</td>
                      <td className="px-3 py-3 font-semibold text-orange-700">{visit.actualZone ?? '-'}</td>
                      <td className="px-3 py-3"><Badge tone={visit.status === 'OK' ? 'success' : visit.status === 'REFUS' ? 'error' : 'warning'}>{formatVisitStatus(visit.status)}</Badge></td>
                      <td className="max-w-md px-3 py-3 text-slate-600">{visit.remark}</td>
                      <td className="px-3 py-3">{visit.latitude && visit.longitude ? <a className="font-black text-orange-600" href={mapsHref(visit.latitude, visit.longitude)} target="_blank">Voir carte</a> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : overviewQuery.isLoading ? (
        <Empty label="Chargement du suivi negociation..." />
      ) : (
        <Empty label="Suivi negociation indisponible." />
      )}
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <p className="text-3xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
    </div>
  );
}

function Select({ label, value, onChange, children }: Readonly<{ label: string; value: string; onChange: (value: string) => void; children: ReactNode }>) {
  return (
    <label className="text-sm font-bold text-slate-700">
      {label}
      <select className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-orange-500" onChange={(event) => onChange(event.target.value)} value={value}>
        {children}
      </select>
    </label>
  );
}

function Empty({ label }: Readonly<{ label: string }>) {
  return <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">{label}</div>;
}

async function fetchNegotiationOverview(
  date: string,
  filters: { projectId: string; resourceId: string; status: string; actualZone: string; q: string },
): Promise<NegotiationOverview> {
  const params = new URLSearchParams({ date });
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.resourceId) params.set('resourceId', filters.resourceId);
  if (filters.status) params.set('status', filters.status);
  if (filters.actualZone) params.set('actualZone', filters.actualZone);
  if (filters.q) params.set('q', filters.q);
  const response = await authFetch(`/api/negotiation/overview?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Impossible de charger le suivi negociation.');
  }
  return response.json() as Promise<NegotiationOverview>;
}

async function downloadNegotiationExport(date: string, pushToast: ReturnType<typeof useToast>['pushToast']) {
  const response = await authFetch(`/api/negotiation/export?date=${encodeURIComponent(date)}`);
  if (!response.ok) {
    pushToast({ type: 'error', title: 'Export impossible', message: await readError(response) });
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `suivi-negociation-${date}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function readError(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  return payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
    ? payload.message
    : 'Operation refusee.';
}

function mapsHref(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function formatVisitStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase();
}
