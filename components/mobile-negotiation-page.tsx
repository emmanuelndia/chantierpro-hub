'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';

type MobileNegotiationDay = {
  date: string;
  assignments: {
    id: string;
    project: { id: string; name: string; city: string };
    plannedZone: string | null;
    instruction: string | null;
    status: string;
  }[];
  openSession: NegotiationSession | null;
  sessions: NegotiationSession[];
  visitStatuses: string[];
};

type NegotiationScope = {
  id: string;
  name: string;
  city: string;
  commune: string | null;
  contactInfo: string | null;
  latitude: number | null;
  longitude: number | null;
  negotiationStatus: string | null;
  remark: string | null;
};

type NegotiationSession = {
  id: string;
  projectId: string;
  project: { id: string; name: string } | null;
  startTime: string;
  endTime: string | null;
  status: string;
  visits: { id: string; buildingName: string; actualZone: string | null; status: string; remark: string; visitedAt: string }[];
  visitCount: number;
};

const todayKey = new Date().toISOString().slice(0, 10);

export function MobileNegotiationPage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [comment, setComment] = useState('');
  const [visitForm, setVisitForm] = useState({
    actualZone: '',
    scopeSearch: '',
    buildingId: '',
    buildingName: '',
    city: '',
    commune: '',
    contactInfo: '',
    status: 'EN_COURS',
    remark: '',
  });

  const dayQuery = useQuery({
    queryKey: ['mobile-negotiation', todayKey],
    queryFn: () => fetchMobileNegotiationDay(todayKey),
    refetchInterval: 45_000,
  });
  const day = dayQuery.data;
  const selectedAssignment = useMemo(
    () => day?.assignments.find((assignment) => assignment.id === selectedAssignmentId) ?? day?.assignments[0],
    [day?.assignments, selectedAssignmentId],
  );
  const openSession = day?.openSession ?? null;
  const scopeQuery = useQuery({
    queryKey: ['mobile-negotiation-scopes', openSession?.projectId, visitForm.scopeSearch],
    queryFn: () => fetchNegotiationScopes(openSession?.projectId ?? '', visitForm.scopeSearch),
    enabled: Boolean(openSession?.projectId),
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const position = await getCurrentPosition();
      await startSession({
        date: todayKey,
        assignmentId: selectedAssignment?.id ?? null,
        projectId: selectedAssignment?.project.id ?? null,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        comment,
      });
    },
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Journee nego demarree' });
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['mobile-negotiation'] });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Pointage impossible', message: getErrorMessage(error) }),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!openSession) {
        throw new Error('Aucune session ouverte.');
      }
      const position = await getCurrentPosition();
      await closeSession(openSession.id, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        comment,
      });
    },
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Journee nego terminee' });
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['mobile-negotiation'] });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Sortie impossible', message: getErrorMessage(error) }),
  });

  const visitMutation = useMutation({
    mutationFn: async () => {
      if (!openSession) {
        throw new Error('Demarre la journee avant une visite.');
      }
      const position = await getCurrentPosition();
      await createVisit({
        sessionId: openSession.id,
        ...visitForm,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
    },
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Scope enregistre' });
      setVisitForm((current) => ({
        actualZone: current.actualZone,
        scopeSearch: '',
        buildingId: '',
        buildingName: '',
        city: '',
        commune: '',
        contactInfo: '',
        status: 'EN_COURS',
        remark: '',
      }));
      await queryClient.invalidateQueries({ queryKey: ['mobile-negotiation'] });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Scope impossible', message: getErrorMessage(error) }),
  });

  function selectScope(scope: NegotiationScope) {
    setVisitForm((current) => ({
      ...current,
      buildingId: scope.id,
      scopeSearch: scope.name,
      buildingName: scope.name,
      city: scope.city,
      commune: scope.commune ?? '',
      contactInfo: scope.contactInfo ?? '',
      remark: current.remark ? current.remark : scope.remark ?? '',
    }));
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Negociation terrain</p>
        <h1 className="mt-2 text-2xl font-black">Journee et visites</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-white/70">
          Pointe ta journee nego puis enregistre chaque immeuble/client visite avec GPS et remarque.
        </p>
      </section>

      {dayQuery.isLoading ? (
        <MobileEmpty label="Chargement..." />
      ) : !day ? (
        <MobileEmpty label="Suivi negociation indisponible." />
      ) : (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Mission du jour</p>
                <h2 className="mt-2 text-xl font-black text-slate-950">
                  {selectedAssignment?.project.name ?? 'Aucune affectation'}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {selectedAssignment?.plannedZone ?? 'Zone non precisee'}
                </p>
              </div>
              <Badge tone={openSession ? 'success' : 'neutral'}>{openSession ? 'Ouverte' : 'Non demarree'}</Badge>
            </div>

            {day.assignments.length > 1 ? (
              <select className="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold" onChange={(event) => setSelectedAssignmentId(event.target.value)} value={selectedAssignment?.id ?? ''}>
                {day.assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>{assignment.project.name} - {assignment.plannedZone ?? 'zone libre'}</option>
                ))}
              </select>
            ) : null}

            {selectedAssignment?.instruction ? (
              <p className="mt-4 rounded-2xl bg-orange-50 p-3 text-sm font-semibold text-orange-900">{selectedAssignment.instruction}</p>
            ) : null}

            <textarea className="mt-4 min-h-20 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-500" onChange={(event) => setComment(event.target.value)} placeholder="Commentaire entree/sortie" value={comment} />

            {!openSession ? (
              <button className="mt-4 w-full rounded-2xl bg-orange-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50" disabled={!selectedAssignment || startMutation.isPending} onClick={() => startMutation.mutate()} type="button">
                Demarrer la journee nego
              </button>
            ) : (
              <button className="mt-4 w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50" disabled={closeMutation.isPending} onClick={() => closeMutation.mutate()} type="button">
                Terminer la journee nego
              </button>
            )}
          </section>

          {openSession ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Scope visite</p>
              <div className="mt-4 space-y-3">
                <Input label="Zone reellement visitee" value={visitForm.actualZone} onChange={(value) => setVisitForm((current) => ({ ...current, actualZone: value }))} />
                <label className="block text-sm font-black text-slate-700">
                  Rechercher un scope existant
                  <input
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-500"
                    onChange={(event) => setVisitForm((current) => ({ ...current, scopeSearch: event.target.value, buildingId: '' }))}
                    placeholder="Nom, ville, commune, contact..."
                    value={visitForm.scopeSearch}
                  />
                </label>
                {(scopeQuery.data?.buildings ?? []).length > 0 ? (
                  <div className="space-y-2 rounded-2xl bg-slate-50 p-2">
                    {(scopeQuery.data?.buildings ?? []).slice(0, 5).map((scope) => (
                      <button className="w-full rounded-xl bg-white px-3 py-2 text-left text-sm font-bold text-slate-800" key={scope.id} onClick={() => selectScope(scope)} type="button">
                        {scope.name}
                        <span className="block text-xs font-semibold text-slate-500">{[scope.city, scope.commune].filter(Boolean).join(' / ') || 'Zone non renseignee'}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <Input label="Scope / client" value={visitForm.buildingName} onChange={(value) => setVisitForm((current) => ({ ...current, buildingName: value, buildingId: '' }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Ville" value={visitForm.city} onChange={(value) => setVisitForm((current) => ({ ...current, city: value }))} />
                  <Input label="Commune" value={visitForm.commune} onChange={(value) => setVisitForm((current) => ({ ...current, commune: value }))} />
                </div>
                <Input label="Interlocuteur/contact" value={visitForm.contactInfo} onChange={(value) => setVisitForm((current) => ({ ...current, contactInfo: value }))} />
                <label className="block text-sm font-black text-slate-700">
                  Statut
                  <select className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold" onChange={(event) => setVisitForm((current) => ({ ...current, status: event.target.value }))} value={visitForm.status}>
                    {day.visitStatuses.map((status) => (
                      <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-black text-slate-700">
                  Remarque a observer
                  <textarea className="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-500" onChange={(event) => setVisitForm((current) => ({ ...current, remark: event.target.value }))} value={visitForm.remark} />
                </label>
                <button className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50" disabled={!visitForm.remark.trim() || visitMutation.isPending} onClick={() => visitMutation.mutate()} type="button">
                  Enregistrer le scope avec GPS
                </button>
              </div>
            </section>
          ) : null}

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Scopes du jour</p>
            <div className="mt-4 space-y-3">
              {(openSession?.visits ?? day.sessions.flatMap((session) => session.visits)).length === 0 ? (
                <MobileEmpty label="Aucun scope enregistre." />
              ) : (
                (openSession?.visits ?? day.sessions.flatMap((session) => session.visits)).map((visit) => (
                  <article className="rounded-2xl bg-slate-50 p-4" key={visit.id}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-black text-slate-950">{visit.buildingName}</p>
                      <Badge tone={visit.status === 'OK' ? 'success' : visit.status === 'REFUS' ? 'error' : 'warning'}>{visit.status.replaceAll('_', ' ')}</Badge>
                    </div>
                    {visit.actualZone ? <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-orange-600">{visit.actualZone}</p> : null}
                    <p className="mt-2 text-sm font-semibold text-slate-600">{visit.remark}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Input({ label, value, onChange }: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <label className="block text-sm font-black text-slate-700">
      {label}
      <input className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-orange-500" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function MobileEmpty({ label }: Readonly<{ label: string }>) {
  return <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-5 text-center text-sm font-bold text-slate-500">{label}</div>;
}

async function fetchMobileNegotiationDay(date: string): Promise<MobileNegotiationDay> {
  const response = await authFetch(`/api/mobile/negotiation?date=${encodeURIComponent(date)}`);
  if (!response.ok) {
    throw new Error('Impossible de charger la negociation.');
  }
  return response.json() as Promise<MobileNegotiationDay>;
}

async function fetchNegotiationScopes(projectId: string, q: string): Promise<{ buildings: NegotiationScope[] }> {
  const params = new URLSearchParams({ projectId, q });
  const response = await authFetch(`/api/negotiation/buildings?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Impossible de charger les scopes.');
  }
  return response.json() as Promise<{ buildings: NegotiationScope[] }>;
}

async function startSession(data: Record<string, unknown>) {
  const response = await authFetch('/api/mobile/negotiation/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<unknown>;
}

async function closeSession(sessionId: string, data: Record<string, unknown>) {
  const response = await authFetch(`/api/mobile/negotiation/session/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<unknown>;
}

async function createVisit(data: Record<string, unknown>) {
  const response = await authFetch('/api/mobile/negotiation/visits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<unknown>;
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

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS indisponible sur cet appareil.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Autorise la localisation pour continuer.')), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}
