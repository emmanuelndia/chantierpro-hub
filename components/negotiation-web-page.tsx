'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { Badge } from '@/components/badge';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';

type NegotiationOverview = {
  date: string;
  projects: { id: string; name: string; city: string; status: string }[];
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
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [date, setDate] = useState(todayKey);
  const [projectId, setProjectId] = useState('');
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [plannedZone, setPlannedZone] = useState('');
  const [instruction, setInstruction] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'preview' | 'commit'>('preview');

  const overviewQuery = useQuery({
    queryKey: ['negotiation-overview', date],
    queryFn: () => fetchNegotiationOverview(date),
    refetchInterval: 60_000,
  });
  const overview = overviewQuery.data;
  const selectedProject = useMemo(() => overview?.projects.find((project) => project.id === projectId), [overview?.projects, projectId]);

  const assignmentMutation = useMutation({
    mutationFn: createNegotiationAssignment,
    onSuccess: async (result) => {
      pushToast({
        type: 'success',
        title: `${result.createdCount} affectation(s) creee(s)`,
        ...(result.skippedCount > 0 ? { message: `${result.skippedCount} deja existante(s) ignoree(s).` } : {}),
      });
      setResourceIds([]);
      setPlannedZone('');
      setInstruction('');
      await queryClient.invalidateQueries({ queryKey: ['negotiation-overview'] });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Planification impossible', message: getErrorMessage(error) }),
  });

  const importMutation = useMutation({
    mutationFn: importNegotiationBuildings,
    onSuccess: async (result) => {
      pushToast({
        type: 'success',
        title: importMode === 'commit' ? `${result.validRows} scope(s) importes` : `${result.validRows} ligne(s) valides`,
        ...(result.invalidRows > 0 ? { message: `${result.invalidRows} ligne(s) ignoree(s).` } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['negotiation-overview'] });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Import impossible', message: getErrorMessage(error) }),
  });

  function submitAssignment() {
    assignmentMutation.mutate({
      date,
      projectId,
      assigneeIds: resourceIds,
      plannedZone,
      instruction,
    });
  }

  function submitImport() {
    if (!projectId || !importFile) {
      pushToast({ type: 'error', title: 'Import incomplet', message: 'Choisis un projet et un fichier Excel.' });
      return;
    }
    importMutation.mutate({ projectId, file: importFile, mode: importMode });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-orange-600">Service negociation</p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-950">Suivi negociation</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              Planifie les journees terrain, importe les scopes et suis les resultats avec GPS, statut et remarques.
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
          <section className="grid gap-4 md:grid-cols-4">
            <Metric label="Affectations" value={overview.assignments.length} />
            <Metric label="Sessions" value={overview.sessions.length} />
            <Metric label="Scopes visites" value={overview.visits.length} />
            <Metric label="Scopes base" value={overview.buildingCount} />
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            {overview.projectScopeSummaries.map((summary) => {
              const project = overview.projects.find((item) => item.id === summary.projectId);
              return (
                <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel" key={summary.projectId}>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">{project?.name ?? 'Projet'}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm font-bold text-slate-700">
                    <ScopeMetric label="Total scopes" value={summary.totalScopes} />
                    <ScopeMetric label="Traites" value={`${summary.treatmentRate}%`} />
                    <ScopeMetric label="Autorisations" value={summary.authorized} />
                    <ScopeMetric label="Refus" value={summary.refused} />
                    <ScopeMetric label="A revisiter" value={summary.revisit} />
                    <ScopeMetric label="Non traites" value={summary.untreated} />
                  </div>
                </article>
              );
            })}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
              <h2 className="text-lg font-black text-slate-950">Planifier une journee nego</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Select label="Projet" value={projectId} onChange={setProjectId}>
                  <option value="">Choisir un projet</option>
                  {overview.projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </Select>
                <label className="text-sm font-bold text-slate-700">
                  Zone prevue
                  <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-orange-500" onChange={(event) => setPlannedZone(event.target.value)} placeholder="Ex: Yopougon Selmer" value={plannedZone} />
                </label>
              </div>
              <div className="mt-4">
                <p className="text-sm font-bold text-slate-700">Ressources nego</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {overview.resources.map((resource) => (
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700" key={resource.id}>
                      <input
                        checked={resourceIds.includes(resource.id)}
                        onChange={(event) =>
                          setResourceIds((current) =>
                            event.target.checked ? [...current, resource.id] : current.filter((id) => id !== resource.id),
                          )
                        }
                        type="checkbox"
                      />
                      {resource.name}
                    </label>
                  ))}
                </div>
              </div>
              <label className="mt-4 block text-sm font-bold text-slate-700">
                Consigne
                <textarea className="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-orange-500" onChange={(event) => setInstruction(event.target.value)} value={instruction} />
              </label>
              <button className="mt-4 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50" disabled={!projectId || resourceIds.length === 0 || assignmentMutation.isPending} onClick={submitAssignment} type="button">
                Planifier {resourceIds.length > 0 ? `${resourceIds.length} ressource(s)` : ''}
              </button>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
              <h2 className="text-lg font-black text-slate-950">Importer scopes HP</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                Projet cible : {selectedProject?.name ?? 'selectionne un projet'}.
              </p>
              <input className="mt-4 block w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} type="file" accept=".xlsx" />
              <select className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm" onChange={(event) => setImportMode(event.target.value as 'preview' | 'commit')} value={importMode}>
                <option value="preview">Previsualiser</option>
                <option value="commit">Importer vraiment</option>
              </select>
              <button className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-orange-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50" disabled={!projectId || !importFile || importMutation.isPending} onClick={submitImport} type="button">
                <Upload className="h-4 w-4" />
                {importMode === 'commit' ? 'Importer' : 'Previsualiser'}
              </button>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
            <h2 className="text-lg font-black text-slate-950">Sessions du jour</h2>
            <div className="mt-4 grid gap-3">
              {overview.sessions.length === 0 ? <Empty label="Aucune session nego pour cette date." /> : overview.sessions.map((session) => <SessionCard key={session.id} session={session} />)}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
            <h2 className="text-lg font-black text-slate-950">Visites immeubles</h2>
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

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <p className="text-3xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
    </div>
  );
}

function ScopeMetric({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
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

function SessionCard({ session }: Readonly<{ session: NegotiationSession }>) {
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-black text-slate-950">{session.user?.name ?? 'Ressource'}</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">{session.project?.name ?? 'Projet'} - {session.visitCount} visite(s)</p>
        </div>
        <Badge tone={session.status === 'OPEN' ? 'success' : 'neutral'}>{session.status === 'OPEN' ? 'Ouverte' : 'Fermee'}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-slate-500">
        <span>Entree {formatTime(session.startTime)}</span>
        {session.endTime ? <span>Sortie {formatTime(session.endTime)}</span> : null}
        {session.startLatitude && session.startLongitude ? <a className="text-orange-600" href={mapsHref(session.startLatitude, session.startLongitude)} target="_blank">Point entree</a> : null}
        {session.endLatitude && session.endLongitude ? <a className="text-orange-600" href={mapsHref(session.endLatitude, session.endLongitude)} target="_blank">Point sortie</a> : null}
      </div>
    </article>
  );
}

function Empty({ label }: Readonly<{ label: string }>) {
  return <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">{label}</div>;
}

async function fetchNegotiationOverview(date: string): Promise<NegotiationOverview> {
  const response = await authFetch(`/api/negotiation/overview?date=${encodeURIComponent(date)}`);
  if (!response.ok) {
    throw new Error('Impossible de charger le suivi negociation.');
  }
  return response.json() as Promise<NegotiationOverview>;
}

async function createNegotiationAssignment(data: { date: string; projectId: string; assigneeIds: string[]; plannedZone: string; instruction: string }) {
  const response = await authFetch('/api/negotiation/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<{ createdCount: number; skippedCount: number }>;
}

async function importNegotiationBuildings(data: { projectId: string; file: File; mode: 'preview' | 'commit' }) {
  const formData = new FormData();
  formData.set('projectId', data.projectId);
  formData.set('mode', data.mode);
  formData.set('file', data.file);
  const response = await authFetch('/api/negotiation/buildings/import', { method: 'POST', body: formData });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<{ validRows: number; invalidRows: number }>;
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Operation refusee.';
}

function mapsHref(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatVisitStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase();
}
