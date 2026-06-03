'use client';

import { useMemo, useState } from 'react';
import { PlanningWorkLocationType } from '@prisma/client';
import { MobileOfficeAssignmentsSection, useTodayOfficeAssignments } from '@/components/mobile-office-assignments-section';
import type { SupervisorMyAssignment } from '@/types/mobile-planning';

type TaskFilter = 'ALL' | 'ON_SITE' | 'OFFICE' | 'FREE_MISSION' | 'BLOCKED' | 'COMPLETED';

const taskFilters: { key: TaskFilter; label: string }[] = [
  { key: 'ALL', label: 'Toutes' },
  { key: 'ON_SITE', label: 'Terrain' },
  { key: 'OFFICE', label: 'Bureau' },
  { key: 'FREE_MISSION', label: 'Missions libres' },
  { key: 'BLOCKED', label: 'Bloquees' },
  { key: 'COMPLETED', label: 'Terminees' },
];

export function MobileTasksPage() {
  const { assignments, usingOfflineAssignments } = useTodayOfficeAssignments();
  const [filter, setFilter] = useState<TaskFilter>('ALL');
  const filteredAssignments = useMemo(() => filterAssignments(assignments, filter), [assignments, filter]);
  const terrainCount = assignments.filter((assignment) => assignment.workLocationType === PlanningWorkLocationType.ON_SITE).length;
  const officeCount = assignments.filter((assignment) => assignment.workLocationType === PlanningWorkLocationType.OFFICE).length;
  const freeMissionCount = assignments.filter((assignment) => assignment.workLocationType === PlanningWorkLocationType.FREE_MISSION).length;
  const blockedCount = assignments.filter((assignment) => assignment.objectiveStatus === 'BLOCKED').length;
  const completedCount = assignments.filter((assignment) => assignment.objectiveStatus === 'ACHIEVED').length;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Taches du jour</p>
        <h1 className="mt-2 text-2xl font-black">Avancement terrain</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-white/70">
          Suivez les objectifs, le realise cumule, les blocages et les taches terminees.
        </p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          <TaskKpi label="Total" value={assignments.length} />
          <TaskKpi label="Terrain" value={terrainCount} />
          <TaskKpi label="Missions" value={freeMissionCount} />
          <TaskKpi label="Bloquees" value={blockedCount} />
        </div>
      </section>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {taskFilters.map((item) => (
          <button
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-black transition ${
              filter === item.key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'
            }`}
            key={item.key}
            onClick={() => setFilter(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {assignments.length === 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <p className="text-base font-black text-slate-950">Aucune tache assignee aujourd&apos;hui</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            Les taches terrain et bureau apparaitront ici des qu&apos;elles seront planifiees.
          </p>
        </section>
      ) : filteredAssignments.length === 0 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <p className="text-base font-black text-slate-950">Aucune tache dans ce filtre</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            Changez de filtre pour retrouver les autres taches du jour.
          </p>
        </section>
      ) : (
        <MobileOfficeAssignmentsSection
          assignments={filteredAssignments}
          description={`Terrain ${terrainCount} - Bureau ${officeCount} - Terminees ${completedCount}`}
          title="Liste des taches"
          usingOfflineData={usingOfflineAssignments}
        />
      )}
    </div>
  );
}

function TaskKpi({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-2xl bg-white/10 p-3 text-center">
      <p className="text-lg font-black">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">{label}</p>
    </div>
  );
}

function filterAssignments(assignments: SupervisorMyAssignment[], filter: TaskFilter) {
  switch (filter) {
    case 'ON_SITE':
      return assignments.filter((assignment) => assignment.workLocationType === PlanningWorkLocationType.ON_SITE);
    case 'OFFICE':
      return assignments.filter((assignment) => assignment.workLocationType === PlanningWorkLocationType.OFFICE);
    case 'FREE_MISSION':
      return assignments.filter((assignment) => assignment.workLocationType === PlanningWorkLocationType.FREE_MISSION);
    case 'BLOCKED':
      return assignments.filter((assignment) => assignment.objectiveStatus === 'BLOCKED');
    case 'COMPLETED':
      return assignments.filter((assignment) => assignment.objectiveStatus === 'ACHIEVED');
    default:
      return assignments;
  }
}
