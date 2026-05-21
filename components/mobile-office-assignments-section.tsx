'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import { getMobileOfflineCache, setMobileOfflineCache } from '@/lib/mobile-offline-db';
import type { SupervisorMyAssignment, SupervisorMyAssignmentsResponse } from '@/types/mobile-planning';

export function useTodayOfficeAssignments() {
  const [usingOfflineAssignments, setUsingOfflineAssignments] = useState(false);

  const assignmentsQuery = useQuery({
    queryKey: ['mobile-my-assignments-today'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const cacheKey = `mobile-planning-my-assignments-${today}`;

      try {
        const response = await authFetch(`/api/mobile/planning/my-assignments?date=${today}`);

        if (!response.ok) {
          throw new Error(`My assignments request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as SupervisorMyAssignmentsResponse;
        setUsingOfflineAssignments(false);
        await setMobileOfflineCache(cacheKey, payload, 24 * 60 * 60 * 1000);
        return payload;
      } catch {
        const cached = await getMobileOfflineCache<SupervisorMyAssignmentsResponse>(cacheKey);

        if (cached) {
          setUsingOfflineAssignments(true);
          return cached.payload;
        }

        throw new Error('My assignments request failed');
      }
    },
    refetchInterval: 60_000,
    staleTime: 300_000,
  });

  const officeAssignments =
    assignmentsQuery.data?.assignments.filter((assignment) => assignment.workLocationType === 'OFFICE') ?? [];

  return {
    officeAssignments,
    usingOfflineAssignments,
  };
}

export function MobileOfficeAssignmentsSection({
  assignments,
  usingOfflineData,
}: Readonly<{
  assignments: SupervisorMyAssignment[];
  usingOfflineData: boolean;
}>) {
  if (assignments.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-indigo-700">
            Taches bureau du jour
          </h2>
          <p className="mt-1 text-sm font-semibold text-indigo-900">
            Ces taches ne demandent pas de pointage chantier.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700">
          {assignments.length}
        </span>
      </div>

      {usingOfflineData ? (
        <p className="mt-3 rounded-lg bg-white/80 p-3 text-xs font-semibold text-indigo-900">
          Donnees hors ligne. Les taches preparees du jour sont affichees.
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {assignments.map((assignment) => (
          <article key={assignment.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{assignment.siteName}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{assignment.siteAddress}</p>
                <p className="mt-2 text-sm leading-5 text-slate-700">{assignment.action}</p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                Bureau
              </span>
            </div>
            {assignment.targetProgress !== null ? (
              <p className="mt-2 text-xs font-bold text-indigo-700">Objectif {assignment.targetProgress}%</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}