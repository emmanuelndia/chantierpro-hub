'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Camera, ClipboardList, Copy, MapPin, UserRound, Wifi } from 'lucide-react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';
import type {
  AdminUserDiagnosticAssignment,
  AdminUserDiagnosticResponse,
  AdminUserDiagnosticSiteOption,
} from '@/types/admin-user-diagnostic';

type Props = Readonly<{
  userId: string;
}>;

export function AdminUserDiagnosticPage({ userId }: Props) {
  const { pushToast } = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const query = useQuery({
    queryKey: ['admin-user-diagnostic', userId, date],
    queryFn: async () => {
      const response = await authFetch(`/api/admin/users/${encodeURIComponent(userId)}/diagnostic?date=${date}`);
      if (!response.ok) {
        const body = (await safeJson(response)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Diagnostic indisponible.');
      }
      return (await response.json()) as AdminUserDiagnosticResponse;
    },
  });
  const reportText = useMemo(() => (query.data ? buildReportText(query.data) : ''), [query.data]);

  function copyReport() {
    if (!reportText) return;
    void navigator.clipboard.writeText(reportText).then(() => {
      pushToast({ type: 'success', title: 'Diagnostic copie' });
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Administration</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Diagnostic utilisateur</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Lecture seule : verification de ce que le compte devrait voir dans le mobile et des blocages probables.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Date</span>
              <input
                className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setDate(event.target.value)}
                type="date"
                value={date}
              />
            </label>
            <Link
              className="inline-flex h-12 items-center rounded-full border border-slate-200 px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              href="/admin/users"
            >
              Retour utilisateurs
            </Link>
          </div>
        </div>
      </section>

      {query.isLoading ? (
        <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-panel">
          <EmptyState description="Analyse du compte, du planning, des photos et du pointage..." title="Diagnostic en cours" />
        </section>
      ) : query.isError ? (
        <section className="rounded-[2rem] border border-red-100 bg-white p-8 shadow-panel">
          <EmptyState
            description={query.error instanceof Error ? query.error.message : "Le diagnostic n'a pas pu etre charge."}
            title="Diagnostic indisponible"
          />
        </section>
      ) : query.data ? (
        <>
          <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <AccountPanel data={query.data} onCopyReport={copyReport} />
            <DiagnosticsPanel data={query.data} />
          </div>

          <SimulatedViewPanel data={query.data} />

          <div className="grid gap-5 xl:grid-cols-2">
            <AssignmentsPanel assignments={query.data.assignments.all} date={query.data.date} userId={query.data.user.id} />
            <ClockInPanel data={query.data} />
            <PhotoPanel sites={query.data.photo.sites} />
            <OfflinePanel data={query.data} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function AccountPanel({ data, onCopyReport }: Readonly<{ data: AdminUserDiagnosticResponse; onCopyReport: () => void }>) {
  return (
    <Panel icon={<UserRound className="h-4 w-4" />} title="Resume compte">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">
            {data.user.firstName} {data.user.lastName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">@{data.user.username}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={data.user.isActive ? 'success' : 'error'}>{data.user.isActive ? 'Actif' : 'Inactif'}</Badge>
          <Badge tone="info">{formatRoleLabel(data.user.role)}</Badge>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Info label="Matricule" value={data.user.matricule ?? '-'} />
        <Info label="Email" value={data.user.email ?? '-'} />
        <Info label="Derniere connexion" value={data.user.lastLoginAt ? formatDateTime(data.user.lastLoginAt) : '-'} />
        <Info label="Date analysee" value={data.date} />
      </div>
      <div className="mt-4 rounded-2xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Perimetre</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {data.user.scopeSummary.map((item) => (
            <span key={item} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          href="/admin/users"
        >
          Ouvrir utilisateurs
        </Link>
        <button
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          onClick={onCopyReport}
          type="button"
        >
          <Copy className="h-4 w-4" />
          Copier rapport
        </button>
      </div>
    </Panel>
  );
}

function DiagnosticsPanel({ data }: Readonly<{ data: AdminUserDiagnosticResponse }>) {
  return (
    <Panel icon={<AlertTriangle className="h-4 w-4" />} title="Blocages detectes">
      {data.diagnostics.length === 0 ? (
        <EmptyLine title="Aucun blocage evident" text="Le compte, les taches et les acces visibles ne remontent pas d'alerte serveur." />
      ) : (
        <div className="space-y-3">
          {data.diagnostics.map((item) => (
            <div key={item.code} className={`rounded-2xl border p-4 ${diagnosticToneClassName(item.severity)}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold text-slate-950">{item.message}</p>
                <Badge tone={item.severity === 'error' ? 'error' : item.severity === 'warning' ? 'warning' : 'info'}>{item.code}</Badge>
              </div>
              {item.hint ? <p className="mt-2 text-sm leading-6 text-slate-600">{item.hint}</p> : null}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SimulatedViewPanel({ data }: Readonly<{ data: AdminUserDiagnosticResponse }>) {
  const rows = [
    { label: 'Bureau', value: data.simulatedView.office },
    { label: 'Chantier', value: data.simulatedView.site },
    { label: 'Zone', value: data.simulatedView.zone },
    { label: 'Deplacement', value: data.simulatedView.professionalTravel },
  ];

  return (
    <Panel icon={<MapPin className="h-4 w-4" />} title="Vue utilisateur simulee">
      <div className="grid gap-3 lg:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-950">{row.label}</p>
              <Badge tone={row.value.available ? 'success' : 'neutral'}>{row.value.available ? 'Visible' : 'Vide'}</Badge>
            </div>
            {row.value.reason ? <p className="mt-3 text-sm leading-6 text-slate-600">{row.value.reason}</p> : null}
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <OptionList title="Options chantier" items={data.simulatedView.site.options} emptyText={data.simulatedView.site.reason ?? 'Aucun chantier.'} />
        <AssignmentList title="Options zone" items={data.simulatedView.zone.options} emptyText={data.simulatedView.zone.reason ?? 'Aucune zone.'} />
      </div>
    </Panel>
  );
}

function AssignmentsPanel({
  assignments,
  date,
  userId,
}: Readonly<{ assignments: AdminUserDiagnosticAssignment[]; date: string; userId: string }>) {
  return (
    <Panel icon={<ClipboardList className="h-4 w-4" />} title="Planning / taches">
      <div className="mb-4 flex flex-wrap gap-3">
        <Link
          className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          href={`/web/users/${encodeURIComponent(userId)}/assignments-history`}
        >
          Historique assignations
        </Link>
        <Link
          className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          href={`/web/planning?date=${date}`}
        >
          Ouvrir planning
        </Link>
      </div>
      {assignments.length === 0 ? (
        <EmptyLine title="Aucune tache pour cette date" text="Verifier que la tache est assignee a cette ressource et au bon jour." />
      ) : (
        <AssignmentList items={assignments} title="Taches trouvees" />
      )}
    </Panel>
  );
}

function ClockInPanel({ data }: Readonly<{ data: AdminUserDiagnosticResponse }>) {
  return (
    <Panel icon={<CalendarDays className="h-4 w-4" />} title="Pointage">
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Evenements du jour" value={String(data.clockIn.recordsCount)} />
        <Metric label="Session ouverte" value={data.clockIn.hasOpenSession ? 'Oui' : 'Non'} />
        <Metric label="Pause active" value={data.clockIn.pauseActive ? 'Oui' : 'Non'} />
        <Metric label="Dernier evenement" value={data.clockIn.lastEventLabel ?? '-'} />
      </div>
      <div className="mt-4 rounded-2xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Session courante</p>
        <p className="mt-2 font-semibold text-slate-950">{data.clockIn.openSessionLabel ?? 'Aucune session ouverte'}</p>
      </div>
    </Panel>
  );
}

function PhotoPanel({ sites }: Readonly<{ sites: AdminUserDiagnosticSiteOption[] }>) {
  return (
    <Panel icon={<Camera className="h-4 w-4" />} title="Photos">
      {sites.length === 0 ? (
        <EmptyLine title="Aucun chantier photo" text="La ressource ne verra aucun chantier disponible pour envoyer une photo." />
      ) : (
        <OptionList items={sites} title="Chantiers disponibles pour photo" />
      )}
    </Panel>
  );
}

function OfflinePanel({ data }: Readonly<{ data: AdminUserDiagnosticResponse }>) {
  return (
    <Panel icon={<Wifi className="h-4 w-4" />} title="Offline">
      <p className="text-sm leading-7 text-slate-600">
        Le serveur peut indiquer les donnees qui devraient etre preparables. Le cache reel du telephone reste local au mobile.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {data.offline.expectedCacheKeys.map((item) => (
          <span key={item} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
            {item}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function AssignmentList({
  title,
  items,
  emptyText = 'Aucune donnee disponible.',
}: Readonly<{ title: string; items: AdminUserDiagnosticAssignment[]; emptyText?: string }>) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={`${item.source}-${item.id}`} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold text-slate-950">{item.label}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="info">{item.kind}</Badge>
                  <Badge tone="neutral">{item.source}</Badge>
                </div>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {item.projectName ?? 'Projet non renseigne'} {item.siteName ? `- ${item.siteName}` : ''}{' '}
                {item.zoneName ? `- ${item.zoneName}` : ''}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-700">{item.action}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionList({
  title,
  items,
  emptyText = 'Aucune option disponible.',
}: Readonly<{ title: string; items: AdminUserDiagnosticSiteOption[]; emptyText?: string }>) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={`${item.source}-${item.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3">
              <div>
                <p className="font-semibold text-slate-950">{item.name}</p>
                <p className="text-sm text-slate-500">{item.projectName ?? 'Projet non renseigne'}</p>
              </div>
              <Badge tone="neutral">{item.source}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Panel({ title, icon, children }: Readonly<{ title: string; icon: ReactNode; children: ReactNode }>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">{icon}</span>
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Info({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function EmptyLine({ title, text }: Readonly<{ title: string; text: string }>) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5">
      <p className="font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}

function diagnosticToneClassName(severity: 'info' | 'warning' | 'error') {
  if (severity === 'error') return 'border-red-100 bg-red-50';
  if (severity === 'warning') return 'border-orange-100 bg-orange-50';
  return 'border-blue-100 bg-blue-50';
}

function buildReportText(data: AdminUserDiagnosticResponse) {
  return [
    `Diagnostic utilisateur - ${data.date}`,
    `${data.user.firstName} ${data.user.lastName} (@${data.user.username})`,
    `Role: ${formatRoleLabel(data.user.role)} - Statut: ${data.user.isActive ? 'Actif' : 'Inactif'}`,
    `Taches: ${data.assignments.all.length}`,
    `Chantiers pointage: ${data.simulatedView.site.options.length}`,
    `Zones pointage: ${data.simulatedView.zone.options.length}`,
    `Chantiers photo: ${data.photo.sites.length}`,
    `Session ouverte: ${data.clockIn.hasOpenSession ? data.clockIn.openSessionLabel ?? 'Oui' : 'Non'}`,
    'Blocages:',
    ...data.diagnostics.map((item) => `- [${item.severity}] ${item.message}${item.hint ? ` (${item.hint})` : ''}`),
  ].join('\n');
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
