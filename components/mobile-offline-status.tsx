'use client';

import { useEffect, useState } from 'react';
import {
  getMobileOfflinePreparationState,
  type MobileOfflinePreparationResult,
} from '@/lib/mobile-offline-prepare';

type State =
  | { status: 'loading'; preparation: null }
  | { status: 'missing' | 'obsolete'; preparation: MobileOfflinePreparationResult | null }
  | { status: 'ready' | 'incomplete'; preparation: MobileOfflinePreparationResult };

export function MobileOfflineStatus() {
  const [state, setState] = useState<State>({ status: 'loading', preparation: null });

  useEffect(() => {
    async function refresh() {
      setState(await getMobileOfflinePreparationState());
    }

    void refresh();
    const handleOnline = () => {
      void refresh();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('mobile-offline-prepared', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('mobile-offline-prepared', handleOnline);
    };
  }, []);

  if (state.status === 'loading') return null;

  const config = {
    ready: ['Offline pret', 'border-emerald-200 bg-emerald-50 text-emerald-800'],
    incomplete: ['Offline incomplet', 'border-amber-200 bg-amber-50 text-amber-800'],
    missing: ['Donnees offline manquantes', 'border-orange-200 bg-orange-50 text-orange-800'],
    obsolete: ['Donnees offline obsoletes', 'border-orange-200 bg-orange-50 text-orange-800'],
  }[state.status];

  return (
    <div className={`border-b px-4 py-2 text-center text-xs font-bold ${config[1]}`}>
      {config[0]}
      {state.preparation ? ` - ${formatTime(state.preparation.preparedAt)}` : ''}
      {state.status === 'incomplete' && state.preparation?.missingRoutes.length
        ? ` - ${state.preparation.missingRoutes.length} page(s) manquante(s)`
        : ''}
    </div>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
