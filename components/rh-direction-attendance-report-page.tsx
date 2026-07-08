'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Role } from '@prisma/client';
import { EmptyState } from '@/components/empty-state';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';
import type { RhDirectionAttendanceReportResponse, RhDirectionAttendanceUser } from '@/types/rh';

type DirectionReportTab = 'not-clocked-today' | 'never-clocked' | 'clocked-today' | 'departure-only';
type DirectionExportScope = 'all' | 'active-tab' | DirectionReportTab;

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white';

const directionReportTabs: { id: DirectionReportTab; label: string }[] = [
  { id: 'not-clocked-today', label: "Pas pointe aujourd'hui" },
  { id: 'never-clocked', label: 'Jamais pointe' },
  { id: 'clocked-today', label: "Ont pointe aujourd'hui" },
  { id: 'departure-only', label: 'Sortie seule' },
];

const directionExportScopes: { id: DirectionExportScope; label: string }[] = [
  { id: 'active-tab', label: 'Onglet affiche' },
  { id: 'all', label: 'Toutes les listes' },
  { id: 'clocked-today', label: "Ont pointe aujourd'hui" },
  { id: 'not-clocked-today', label: "Pas pointe aujourd'hui" },
  { id: 'never-clocked', label: 'Jamais pointe' },
  { id: 'departure-only', label: 'Sortie seule' },
];

const directionRoleOptions = Object.values(Role)
  .filter((role) => role !== Role.DIRECTION)
  .map((role) => ({ id: role, label: formatRoleLabel(role) }));

export function RhDirectionAttendanceReportPage() {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<DirectionReportTab>('not-clocked-today');
  const [selectedRoles, setSelectedRoles] = useState<Role[]>([]);
  const [exportScope, setExportScope] = useState<DirectionExportScope>('active-tab');
  const [exportingFormat, setExportingFormat] = useState<'xlsx' | 'pdf' | null>(null);

  const rolesQueryValue = selectedRoles.join(',');

  const reportQuery = useQuery({
    queryKey: ['rh-direction-attendance-report', selectedDate, rolesQueryValue],
    queryFn: async () => {
      const query = new URLSearchParams({ date: selectedDate });
      if (rolesQueryValue) query.set('roles', rolesQueryValue);
      const response = await authFetch(`/api/rh/direction-attendance-report?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Direction attendance report failed with status ${response.status}`);
      }

      return (await response.json()) as RhDirectionAttendanceReportResponse;
    },
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });

  const data = reportQuery.data ?? null;
  const users = useMemo(() => (data ? getDirectionReportUsers(data, activeTab) : []), [activeTab, data]);

  if (reportQuery.isError) {
    return (
      <EmptyState
        description="Le rapport Direction ne peut pas etre charge pour le moment."
        title="Rapport indisponible"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Rapport Direction</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Adoption du pointage</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Suivez les comptes actifs qui utilisent le pointage, les absences de pointage a la date choisie, et les comptes sans aucun pointage.
            </p>
            <div className="mt-5 flex max-w-4xl flex-wrap gap-2">
              {directionRoleOptions.map((role) => {
                const selected = selectedRoles.includes(role.id);
                return (
                  <button
                    className={`rounded-full border px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.1em] transition ${
                      selected ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                    key={role.id}
                    onClick={() => setSelectedRoles((current) => toggleDirectionRole(current, role.id))}
                    type="button"
                  >
                    {role.label}
                  </button>
                );
              })}
              {selectedRoles.length > 0 ? (
                <button
                  className="rounded-full border border-orange-200 bg-orange-50 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.1em] text-orange-700 transition hover:bg-orange-100"
                  onClick={() => setSelectedRoles([])}
                  type="button"
                >
                  Tous les roles
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Date</span>
              <input
                className={inputClassName}
                onChange={(event) => setSelectedDate(event.target.value)}
                type="date"
                value={selectedDate}
              />
            </label>
            <label className="min-w-[13rem] space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Contenu exporte</span>
              <select
                className={inputClassName}
                onChange={(event) => setExportScope(event.target.value as DirectionExportScope)}
                value={exportScope}
              >
                {directionExportScopes.map((scope) => (
                  <option key={scope.id} value={scope.id}>{scope.label}</option>
                ))}
              </select>
            </label>
            <button
              className="rounded-full border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => void reportQuery.refetch()}
              type="button"
            >
              Actualiser
            </button>
            <button
              className="rounded-full bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              disabled={!data || exportingFormat !== null || reportQuery.isFetching}
              onClick={() => void downloadDirectionReportExport(selectedDate, 'xlsx', resolveDirectionExportScope(exportScope, activeTab), selectedRoles, setExportingFormat)}
              type="button"
            >
              {exportingFormat === 'xlsx' ? 'Generation...' : 'Export Excel'}
            </button>
            <button
              className="rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              disabled={!data || exportingFormat !== null || reportQuery.isFetching}
              onClick={() => void downloadDirectionReportExport(selectedDate, 'pdf', resolveDirectionExportScope(exportScope, activeTab), selectedRoles, setExportingFormat)}
              type="button"
            >
              {exportingFormat === 'pdf' ? 'Generation...' : 'Export PDF'}
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              disabled={!data || exportingFormat !== null || reportQuery.isFetching}
              onClick={() => exportDirectionReportCsv(data, resolveDirectionExportScope(exportScope, activeTab))}
              type="button"
            >
              CSV
            </button>
          </div>
        </div>
      </section>

      {reportQuery.isLoading && !data ? (
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500 shadow-panel">
          Chargement du rapport...
        </section>
      ) : null}

      {data ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DirectionMetric label="Utilisateurs actifs" value={data.summary.activeUsers} />
            <DirectionMetric label="Ont pointe" tone="success" value={data.summary.clockedToday} />
            <DirectionMetric label="Pas pointe ce jour" tone="warning" value={data.summary.notClockedToday} />
            <DirectionMetric label="Jamais pointe" tone={data.summary.neverClocked > 0 ? 'danger' : 'neutral'} value={data.summary.neverClocked} />
            <DirectionMetric label="Sortis" value={data.summary.leftToday} />
            <DirectionMetric label="Sessions ouvertes" tone={data.summary.openSessions > 0 ? 'warning' : 'neutral'} value={data.summary.openSessions} />
            <DirectionMetric label="Retards" tone={data.summary.lateToday > 0 ? 'warning' : 'neutral'} value={data.summary.lateToday} />
            <DirectionMetric label="Sortie sans entree" tone={data.summary.departureOnlyToday > 0 ? 'danger' : 'neutral'} value={data.summary.departureOnlyToday} />
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">Listes Direction</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">Utilisateurs suivis</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Rapport du {formatDate(data.date)}, genere a {formatTime(data.generatedAt)}.
                </p>
              </div>
              {reportQuery.isFetching ? <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Mise a jour...</p> : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {directionReportTabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.1em] transition ${
                      active ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    type="button"
                  >
                    {tab.label} <span className="ml-1">{getDirectionReportUsers(data, tab.id).length}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              {users.length === 0 ? (
                <div className="bg-slate-50 p-5 text-sm font-semibold text-slate-500">Aucun utilisateur dans cette liste.</div>
              ) : (
                <div className="max-h-[32rem] overflow-auto divide-y divide-slate-100 bg-white">
                  {users.map((user) => (
                    <DirectionReportUserRow key={user.id} user={user} />
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function DirectionMetric({
  label,
  value,
  tone = 'neutral',
}: Readonly<{
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}>) {
  const toneClassName = {
    neutral: 'border-slate-200 bg-white text-slate-950',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    warning: 'border-orange-200 bg-orange-50 text-orange-950',
    danger: 'border-red-200 bg-red-50 text-red-950',
  }[tone];

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function DirectionReportUserRow({ user }: Readonly<{ user: RhDirectionAttendanceUser }>) {
  return (
    <article className="grid gap-3 p-4 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(160px,0.8fr)_minmax(160px,0.8fr)] md:items-center">
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-950">{user.lastName} {user.firstName}</p>
        <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
          {user.matricule ?? 'Sans matricule'} - {formatRoleLabel(user.role as Role)}
        </p>
      </div>
      <div className="text-slate-600">
        <p>Entree jour : <span className="font-semibold text-slate-900">{user.todayArrivalAt ? formatTime(user.todayArrivalAt) : '-'}</span></p>
        <p className="mt-1">Sortie jour : <span className="font-semibold text-slate-900">{user.todayDepartureAt ? formatTime(user.todayDepartureAt) : '-'}</span></p>
      </div>
      <div className="text-slate-600">
        <p>Dernier pointage : <span className="font-semibold text-slate-900">{user.lastClockInAt ? formatDateTime(user.lastClockInAt) : '-'}</span></p>
        <p className="mt-1">Compte cree : <span className="font-semibold text-slate-900">{formatDate(user.createdAt)}</span></p>
      </div>
    </article>
  );
}

function getDirectionReportUsers(data: RhDirectionAttendanceReportResponse, tab: DirectionReportTab) {
  if (tab === 'clocked-today') return data.users.clockedToday;
  if (tab === 'never-clocked') return data.users.neverClocked;
  if (tab === 'departure-only') return data.users.departureOnlyToday;
  return data.users.notClockedToday;
}

function resolveDirectionExportScope(scope: DirectionExportScope, activeTab: DirectionReportTab) {
  return scope === 'active-tab' ? activeTab : scope;
}

function toggleDirectionRole(current: Role[], role: Role) {
  const next = current.includes(role) ? current.filter((item) => item !== role) : [...current, role];
  return next.sort((left, right) => left.localeCompare(right));
}

async function downloadDirectionReportExport(
  selectedDate: string,
  format: 'xlsx' | 'pdf',
  scope: 'all' | DirectionReportTab,
  roles: Role[],
  setExportingFormat: (format: 'xlsx' | 'pdf' | null) => void,
) {
  setExportingFormat(format);
  try {
    const query = new URLSearchParams({ date: selectedDate, format, scope });
    if (roles.length > 0) query.set('roles', roles.join(','));
    const response = await authFetch(
      `/api/rh/direction-attendance-report/export?${query.toString()}`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      throw new Error(`Direction report export failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('content-disposition');
    const match = contentDisposition?.match(/filename=\"?([^\";]+)\"?/);
    const fallbackFileName = format === 'pdf'
      ? buildDirectionPdfFallbackFileName(scope)
      : `rapport-direction-pointage-${selectedDate}.${format}`;
    triggerDownload(blob, match?.[1] ?? fallbackFileName);
  } finally {
    setExportingFormat(null);
  }
}

function buildDirectionPdfFallbackFileName(scope: 'all' | DirectionReportTab) {
  const downloadDate = formatDirectionDownloadDate(new Date());
  if (scope === 'clocked-today') return `recap-pointage-present-${downloadDate}.pdf`;
  if (scope === 'not-clocked-today') return `recap-pointage-absent-${downloadDate}.pdf`;
  if (scope === 'never-clocked') return 'recap-aucun-pointage.pdf';
  if (scope === 'departure-only') return `recap-pointage-sortie-seule-${downloadDate}.pdf`;
  return `recap-pointage-${downloadDate}.pdf`;
}

function formatDirectionDownloadDate(value: Date) {
  const day = String(value.getDate()).padStart(2, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const year = value.getFullYear();
  return `${day}-${month}-${year}`;
}
function exportDirectionReportCsv(data: RhDirectionAttendanceReportResponse | null, scope: 'all' | DirectionReportTab) {
  if (!data) return;
  const sections = getDirectionReportExportSections(data, scope);
  const rows = [
    ['liste', 'matricule', 'nom', 'prenom', 'role', 'entree_jour', 'sortie_jour', 'premier_pointage', 'dernier_pointage', 'compte_cree'],
    ...sections.flatMap((section) => section.users.map((user) => directionReportCsvRow(section.csvName, user))),
  ];
  const csv = rows.map((row) => row.map(escapeCsvValue).join(';')).join('\n');
  const suffix = scope === 'all' ? '' : `-${scope}`;
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `rapport-direction-pointage-${data.date}${suffix}.csv`);
}

function getDirectionReportExportSections(data: RhDirectionAttendanceReportResponse, scope: 'all' | DirectionReportTab) {
  const sections = [
    { scope: 'clocked-today' as const, csvName: 'ont_pointe', users: data.users.clockedToday },
    { scope: 'not-clocked-today' as const, csvName: 'pas_pointe_ce_jour', users: data.users.notClockedToday },
    { scope: 'never-clocked' as const, csvName: 'jamais_pointe', users: data.users.neverClocked },
    { scope: 'departure-only' as const, csvName: 'sortie_sans_entree', users: data.users.departureOnlyToday },
  ];

  return scope === 'all' ? sections : sections.filter((section) => section.scope === scope);
}

function directionReportCsvRow(listName: string, user: RhDirectionAttendanceUser) {
  return [
    listName,
    user.matricule ?? '',
    user.lastName,
    user.firstName,
    formatRoleLabel(user.role as Role),
    user.todayArrivalAt ? formatTime(user.todayArrivalAt) : '',
    user.todayDepartureAt ? formatTime(user.todayDepartureAt) : '',
    user.firstClockInAt ? formatDateTime(user.firstClockInAt) : '',
    user.lastClockInAt ? formatDateTime(user.lastClockInAt) : '',
    formatDate(user.createdAt),
  ];
}

function escapeCsvValue(value: string) {
  const normalized = value.replace(/"/g, '""');
  return /[;"\n]/.test(normalized) ? `"${normalized}"` : normalized;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('fr-FR');
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}