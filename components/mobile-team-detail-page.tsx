'use client';

import { TeamMemberStatus, TeamRole } from '@prisma/client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import { useToast } from '@/components/toast-provider';
import type { MobileTeamDetailResponse } from '@/types/mobile-teams';

type MobileTeamDetailPageProps = Readonly<{
  teamId: string;
}>;

export function MobileTeamDetailPage({ teamId }: MobileTeamDetailPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [userId, setUserId] = useState('');
  const [teamRole, setTeamRole] = useState<TeamRole>(TeamRole.MEMBER);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['mobile-team-detail', teamId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/teams/${encodeURIComponent(teamId)}`);
      if (!response.ok) {
        // Lancer une erreur avec le statut pour une gestion spécifique
        const error = new Error(`Team detail request failed with status ${response.status}`);
        (error as any).status = response.status;
        throw error;
      }
      return (await response.json()) as MobileTeamDetailResponse;
    },
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      const response = await authFetch(`/api/mobile/teams/${encodeURIComponent(teamId)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, teamRole }),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Impossible d'ajouter ce membre."));
      }
    },
    onSuccess: () => {
      setUserId('');
      setTeamRole(TeamRole.MEMBER);
      void queryClient.invalidateQueries({ queryKey: ['mobile-team-detail', teamId] });
    },
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : "Impossible d'ajouter ce membre."),
  });

  const removeMutation = useMutation({
    mutationFn: async (memberUserId: string) => {
      setErrorMessage(null);
      const response = await authFetch(
        `/api/mobile/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberUserId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Impossible de retirer ce membre.'));
      }
    },
    onMutate: async (memberUserId) => {
      // Mise à jour optimiste : retirer immédiatement le membre de la liste
      const previousData = queryClient.getQueryData(['mobile-team-detail', teamId]) as MobileTeamDetailResponse;
      
      queryClient.setQueryData(['mobile-team-detail', teamId], (old: MobileTeamDetailResponse | undefined) => {
        if (!old) return old;
        
        return {
          ...old,
          members: old.members.filter(member => member.userId !== memberUserId),
        };
      });
      
      return { previousData };
    },
    onSuccess: (_, memberUserId) => {
      // Afficher un toast de succès
      pushToast({
        title: 'Membre retiré',
        message: 'Le membre a été retiré de l\'équipe avec succès.',
        type: 'success',
      });
      
      // Rafraîchir les données pour s'assurer que tout est synchronisé
      void queryClient.invalidateQueries({ queryKey: ['mobile-team-detail', teamId] });
    },
    onError: (error, memberUserId, context) => {
      // Restaurer les données précédentes en cas d'erreur
      if (context?.previousData) {
        queryClient.setQueryData(['mobile-team-detail', teamId], context.previousData);
      }
      
      setErrorMessage(error instanceof Error ? error.message : 'Impossible de retirer ce membre.');
      
      // Afficher un toast d'erreur
      pushToast({
        title: 'Erreur',
        message: error instanceof Error ? error.message : 'Impossible de retirer ce membre.',
        type: 'error',
      });
    },
  });

  const detail = detailQuery.data;

  if (detailQuery.isLoading) return <TeamDetailLoadingState />;
  if (detailQuery.isError || !detail) {
    // Déterminer le message d'erreur spécifique selon le statut
    const error = detailQuery.error as any;
    let errorMessage = 'Impossible de charger cette équipe.';
    let errorDescription = 'Vérifiez votre accès puis réessayez.';
    
    if (error?.status) {
      switch (error.status) {
        case 404:
          errorMessage = 'Cette équipe n\'existe pas ou a été supprimée.';
          errorDescription = 'L\'équipe que vous cherchez n\'est pas disponible ou a été supprimée.';
          break;
        case 403:
          errorMessage = 'Vous n\'avez pas accès à cette équipe.';
          errorDescription = 'Contactez votre administrateur pour obtenir les accès nécessaires.';
          break;
        default:
          errorMessage = 'Erreur lors du chargement de l\'équipe.';
          errorDescription = `Une erreur est survenue (code: ${error.status}). Veuillez réessayer.`;
      }
    }

    return (
      <div className="space-y-5 pb-20">
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-bold text-red-700 mb-2">{errorMessage}</h2>
          <p className="text-xs text-red-600">{errorDescription}</p>
        </section>
        <Link
          className="flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700 shadow-panel"
          href="/mobile/teams"
        >
          Retour aux équipes
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`rounded-full px-2 py-1 text-[11px] font-black ${detail.team.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
              {detail.team.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </span>
            <h1 className="mt-3 text-2xl font-black leading-7 text-slate-950">{detail.team.name}</h1>
            <p className="mt-1 text-sm font-bold text-slate-600">{detail.team.projectName}</p>
            <Link className="mt-1 block text-sm font-black text-primary" href={`/mobile/sites/${encodeURIComponent(detail.team.siteId)}`}>
              {detail.team.siteName}
            </Link>
          </div>
          {detail.canMutate ? (
            <Link
              className="flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-sm font-black text-white"
              href={`/mobile/teams/${encodeURIComponent(teamId)}/edit`}
            >
              Modifier
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Metric label="Actifs" value={detail.team.activeMembersCount} />
        <Metric label="Total" value={detail.team.membersCount} />
        <Metric label="Disponibles" value={detail.availableMembers.length} />
      </section>

      {errorMessage ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {errorMessage}
        </section>
      ) : null}

      {detail.canMutate ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <h2 className="text-base font-black text-slate-950">Ajouter un membre</h2>
          <select
            className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900"
            onChange={(event) => setUserId(event.target.value)}
            value={userId}
          >
            <option value="">Choisir un membre</option>
            {detail.availableMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.firstName} {member.lastName}
              </option>
            ))}
          </select>
          <select
            className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900"
            onChange={(event) => setTeamRole(event.target.value as TeamRole)}
            value={teamRole}
          >
            <option value={TeamRole.MEMBER}>Membre</option>
            <option value={TeamRole.TEAM_LEAD}>Chef d&apos;équipe</option>
          </select>
          <button
            className="flex min-h-12 w-full items-center justify-center rounded-lg bg-primary text-sm font-black text-white disabled:opacity-60"
            disabled={!userId || addMutation.isPending}
            onClick={() => addMutation.mutate()}
            type="button"
          >
            {addMutation.isPending ? 'Ajout...' : 'Ajouter'}
          </button>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Membres</h2>
        {detail.members.map((member) => (
          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel" key={member.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-black text-slate-950">
                  {member.firstName} {member.lastName}
                </h3>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {formatTeamRole(member.teamRole)} · {formatMemberStatus(member.status)}
                </p>
              </div>
              {detail.canMutate && member.status === TeamMemberStatus.ACTIVE ? (
                <button
                  className="min-h-10 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700 disabled:opacity-60"
                  disabled={removeMutation.isPending || member.userId === detail.team.teamLeadId}
                  onClick={() => {
                    if (window.confirm('Retirer ce membre de l’équipe ?')) {
                      removeMutation.mutate(member.userId);
                    }
                  }}
                  type="button"
                >
                  Retirer
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 text-center shadow-panel">
      <p className="text-xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
    </article>
  );
}

function TeamDetailLoadingState() {
  return (
    <div className="space-y-5 pb-20">
      <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function formatTeamRole(role: TeamRole) {
  return role === TeamRole.TEAM_LEAD ? "Chef d'équipe" : 'Membre';
}

function formatMemberStatus(status: TeamMemberStatus) {
  return status === TeamMemberStatus.ACTIVE ? 'Actif' : 'Inactif';
}

async function getApiErrorMessage(response: Response, fallback: string) {
  // Les réponses 204 No Content n'ont pas de body
  if (response.status === 204) {
    return fallback;
  }
  
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? fallback;
  } catch {
    return fallback;
  }
}
