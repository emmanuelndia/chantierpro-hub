'use client';

import { useEffect, useState } from 'react';
import { MobileAppShell } from '@/components/mobile-app-shell';
import { MobileClockInPage } from '@/components/mobile-clock-in-page';
import { MobileFieldHomePage } from '@/components/mobile-field-home-page';
import { MobileCoordinatorHomePage } from '@/components/mobile-coordinator-home-page';
import { MobileGeneralSupervisorHomePage } from '@/components/mobile-general-supervisor-home-page';
import { MobilePhotoCameraPage } from '@/components/mobile-photo-camera-page';
import { MobileHistoryPage } from '@/components/mobile-history-page';
import { MobilePlanningPage } from '@/components/mobile-planning-page';
import { MobileSessionReportPage } from '@/components/mobile-session-report-page';
import { MobileSyncPage } from '@/components/mobile-sync-page';
import { getMobileOfflineCache } from '@/lib/mobile-offline-db';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { MobileOfflinePreparationResult } from '@/lib/mobile-offline-prepare';

type OfflineShellState =
  | { status: 'loading'; user: null }
  | { status: 'missing'; user: null; preparation: MobileOfflinePreparationResult | null }
  | { status: 'ready'; user: WebSessionUser };

export function MobileOfflineTerrainShell() {
  const [state, setState] = useState<OfflineShellState>({ status: 'loading', user: null });

  useEffect(() => {
    void Promise.all([
      getMobileOfflineCache<WebSessionUser>('offline-user'),
      getMobileOfflineCache<MobileOfflinePreparationResult>('offline-preparation-meta'),
    ]).then(([cachedUser, cachedPreparation]) => {
      setState(
        cachedUser
          ? { status: 'ready', user: cachedUser.payload }
          : { status: 'missing', user: null, preparation: cachedPreparation?.payload ?? null },
      );
    });
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6 text-sm font-bold text-slate-500">
        Ouverture du mode hors ligne...
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
        <section className="max-w-sm rounded-lg border border-orange-200 bg-orange-50 p-5 text-center">
          <h1 className="text-xl font-black text-slate-950">Session offline indisponible</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-orange-900">
            {state.preparation
              ? "La session locale n'a pas ete enregistree correctement. Reconnectez-vous et relancez la synchronisation offline."
              : "Connectez-vous une fois avec internet avant d'utiliser le mode hors ligne sur cet appareil."}
          </p>
          {state.preparation ? (
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-orange-700">
              Derniere preparation {formatPreparedAt(state.preparation.preparedAt)}
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  return <MobileAppShell user={state.user}>{renderOfflineRoute(window.location.pathname, state.user)}</MobileAppShell>;
}

function renderOfflineRoute(pathname: string, user: WebSessionUser) {
  if (pathname === '/mobile/clock-in') {
    return <MobileClockInPage userRole={user.role} />;
  }

  if (pathname === '/mobile/photo') {
    return <MobilePhotoCameraPage />;
  }

  if (pathname === '/mobile/history') {
    return <MobileHistoryPage />;
  }

  if (pathname === '/mobile/planning') {
    return <MobilePlanningPage user={user} />;
  }

  if (pathname === '/mobile/sync') {
    return <MobileSyncPage />;
  }

  if (pathname === '/rapport-session') {
    return <MobileSessionReportPage user={user} />;
  }

  if (user.role === 'COORDINATOR') {
    return <MobileCoordinatorHomePage user={user} />;
  }

  if (
    user.role === 'GENERAL_SUPERVISOR' ||
    user.role === 'BE_MANAGER' ||
    user.role === 'NEGOTIATION_MANAGER' ||
    user.role === 'FLEET_MANAGER'
  ) {
    return <MobileGeneralSupervisorHomePage user={user} />;
  }

  return <MobileFieldHomePage user={user} />;
}

function formatPreparedAt(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
