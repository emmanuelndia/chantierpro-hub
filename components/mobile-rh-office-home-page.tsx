'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { TodayClockInView } from '@/types/clock-in';
import type { MobilePresenceListResponse } from '@/types/mobile-management-presences';

type MobileRhOfficeHomePageProps = Readonly<{
  user: WebSessionUser;
  mode: 'HR' | 'OFFICE_STAFF';
}>;

export function MobileRhOfficeHomePage({ mode, user }: MobileRhOfficeHomePageProps) {
  const clockInQuery = useQuery({
    queryKey: ['mobile-home-clock-in-status'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me/clock-in');
      if (!response.ok) throw new Error('Clock-in status failed');
      return (await response.json()) as TodayClockInView;
    },
    staleTime: 30_000,
  });

  const presencesQuery = useQuery({
    enabled: mode === 'HR',
    queryKey: ['mobile-home-rh-presences'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/presences');
      if (!response.ok) throw new Error('Mobile presences failed');
      return (await response.json()) as MobilePresenceListResponse;
    },
    staleTime: 30_000,
  });

  const activeSession = clockInQuery.data?.activeSession ?? null;
  const summary = presencesQuery.data?.summary;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">
          {mode === 'HR' ? 'Accueil RH' : 'Personnel bureau'}
        </p>
        <h1 className="mt-2 text-2xl font-black">Bonjour {user.firstName}</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-white/70">
          {mode === 'HR'
            ? 'Suivez les presences du jour et pointez au bureau si necessaire.'
            : 'Pointez votre presence au bureau et consultez votre profil.'}
        </p>
        {mode === 'HR' ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Kpi label="Presents" value={summary?.present ?? 0} />
            <Kpi label="Bureau" value={summary?.office ?? 0} />
            <Kpi label="Retards" value={summary?.late ?? 0} />
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Pointage du jour</p>
        <h2 className="mt-2 text-lg font-black text-slate-950">
          {activeSession ? `Session ouverte - ${contextLabel(activeSession.contextType)}` : 'Aucune session ouverte'}
        </h2>
        <p className="mt-2 text-sm font-semibold text-slate-600">
          {activeSession
            ? `Entree a ${formatTime(activeSession.arrivalAt)}`
            : 'Vous pouvez pointer au bureau depuis le bouton ci-dessous.'}
        </p>
        <Link
          className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 text-sm font-black text-white"
          href="/mobile/clock-in?office=1"
        >
          Pointer au bureau
        </Link>
      </section>

      <section className="grid grid-cols-2 gap-3">
        {mode === 'HR' ? (
          <>
            <QuickLink href="/mobile/presences" label="Presences" />
            <QuickLink href="/web/rh/resources" label="Ressources RH" />
          </>
        ) : null}
        <QuickLink href="/mobile/clock-in?office=1" label="Pointage" />
        <QuickLink href="/mobile/profile" label="Profil" />
      </section>
    </div>
  );
}

function Kpi({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-2xl bg-white/10 p-3 text-center">
      <p className="text-xl font-black">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">{label}</p>
    </div>
  );
}

function QuickLink({ href, label }: Readonly<{ href: string; label: string }>) {
  return (
    <Link className="flex min-h-20 items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 text-center text-sm font-black text-slate-900 shadow-panel" href={href}>
      {label}
    </Link>
  );
}

function contextLabel(context: 'SITE' | 'FREE_MISSION' | 'OFFICE') {
  if (context === 'OFFICE') return 'bureau';
  if (context === 'FREE_MISSION') return 'zone';
  return 'chantier';
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
