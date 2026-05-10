'use client';

import Link from 'next/link';
import { TeamMemberStatus, TeamRole, TeamStatus } from '@prisma/client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { WebTeamDetailResponse, WebTeamMember } from '@/types/web-teams';

type WebTeamDetailPageProps = Readonly<{
  teamId: string;
}>;

const selectClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';

export function WebTeamDetailPage({ teamId }: WebTeamDetailPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [userId, setUserId] = useState('');
  const [teamRole, setTeamRole] = useState<TeamRole>(TeamRole.MEMBER);
  const [removeTarget, setRemoveTarget] = useState<WebTeamMember | null>(null);

  const detailQuery = useQuery({
    queryKey: ['web-team-detail', teamId],
    queryFn: () => fetchTeamDetail(teamId),
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async () => addMember(teamId, { userId, teamRole }),
    onSuccess: async (payload) => {
      pushToast({
        type: 'success',
        title: payload.reactivated ? 'Membre reactive' : 'Membre ajoute',
      });
      setUserId('');
      setTeamRole(TeamRole.MEMBER);
      await queryClient.invalidateQueries({ queryKey: ['web-team-detail', teamId] });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Ajout impossible', message: error instanceof Error ? error.message : 'Operation refusee.' }),
  });

  const removeMutation = useMutation({
    mutationFn: (memberUserId: string) => removeMember(teamId, memberUserId),
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Membre retire' });
      setRemoveTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['web-team-detail', teamId] });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Retrait impossible', message: error instanceof Error ? error.message : 'Operation refusee.' }),
  });

  const detail = detailQuery.data;

  if (detailQuery.isLoading) return <LoadingState />;
  if (detailQuery.isError || !detail) {
    return <EmptyState title="Equipe indisponible" description="Cette equipe est introuvable ou hors de votre perimetre." ctaHref="/web/teams" ctaLabel="Retour aux equipes" />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <Badge tone={detail.team.status === TeamStatus.ACTIVE ? 'success' : 'neutral'}>{detail.team.status === TeamStatus.ACTIVE ? 'Active' : 'Inactive'}</Badge>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{detail.team.name}</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              {detail.team.projectName} / {detail.team.siteName} / Chef: {detail.team.teamLeadName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50" href="/web/teams">
              Retour
            </Link>
            <Link className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800" href={`/web/teams/${teamId}/edit`}>
              Modifier
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Membres actifs" value={detail.activeMembers.length} />
        <MetricCard label="Historique" value={detail.inactiveMembers.length} />
        <MetricCard label="Disponibles" value={detail.availableMembers.length} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <h2 className="text-lg font-semibold text-slate-950">Ajouter un membre</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px_auto]">
          <select className={selectClassName} onChange={(event) => setUserId(event.target.value)} value={userId}>
            <option value="">Choisir une ressource</option>
            {detail.availableMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.firstName} {member.lastName}
              </option>
            ))}
          </select>
          <select className={selectClassName} onChange={(event) => setTeamRole(event.target.value as TeamRole)} value={teamRole}>
            <option value={TeamRole.MEMBER}>Membre</option>
            <option value={TeamRole.TEAM_LEAD}>Chef d&apos;equipe</option>
          </select>
          <button
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            disabled={!userId || addMutation.isPending}
            onClick={() => addMutation.mutate()}
            type="button"
          >
            {addMutation.isPending ? 'Ajout...' : 'Ajouter'}
          </button>
        </div>
      </section>

      <MembersSection
        members={detail.activeMembers}
        onRemove={setRemoveTarget}
        teamLeadId={detail.team.teamLeadId}
        title="Membres actifs"
      />
      <MembersSection members={detail.inactiveMembers} title="Historique membres inactifs" />

      {removeTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <section className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-panel">
            <h2 className="text-xl font-semibold text-slate-950">Retirer ce membre ?</h2>
            <p className="mt-3 text-sm text-slate-600">
              {removeTarget.firstName} {removeTarget.lastName} passera dans l&apos;historique inactif.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700" onClick={() => setRemoveTarget(null)} type="button">
                Annuler
              </button>
              <button className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(removeTarget.userId)} type="button">
                Retirer
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MembersSection({
  title,
  members,
  teamLeadId,
  onRemove,
}: Readonly<{
  title: string;
  members: WebTeamMember[];
  teamLeadId?: string;
  onRemove?: (member: WebTeamMember) => void;
}>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <Badge tone="neutral">{members.length}</Badge>
      </div>
      {members.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aucun membre.</p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {members.map((member) => (
            <article className="rounded-2xl border border-slate-200 p-4" key={member.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">
                    {member.firstName} {member.lastName}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {member.role} / {member.teamRole === TeamRole.TEAM_LEAD ? "Chef d'equipe" : 'Membre'}
                  </p>
                </div>
                <Badge tone={member.status === TeamMemberStatus.ACTIVE ? 'success' : 'neutral'}>
                  {member.status === TeamMemberStatus.ACTIVE ? 'Actif' : 'Inactif'}
                </Badge>
              </div>
              {onRemove && member.status === TeamMemberStatus.ACTIVE ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                    href={`/web/users/${encodeURIComponent(member.userId)}/assignments-history`}
                  >
                    Historique
                  </Link>
                  <button
                    className="rounded-2xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    disabled={member.userId === teamLeadId}
                    onClick={() => onRemove(member)}
                    type="button"
                  >
                    Retirer
                  </button>
                </div>
              ) : (
                <Link
                  className="mt-4 inline-flex rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  href={`/web/users/${encodeURIComponent(member.userId)}/assignments-history`}
                >
                  Historique
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

async function fetchTeamDetail(teamId: string) {
  const response = await authFetch(`/api/teams/web/${teamId}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Team detail request failed with status ${response.status}`);
  return (await response.json()) as WebTeamDetailResponse;
}

async function addMember(teamId: string, payload: { userId: string; teamRole: TeamRole }) {
  const response = await authFetch(`/api/teams/web/${teamId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as { message?: string; reactivated?: boolean } | null;
  if (!response.ok) throw new Error(body?.message ?? "Impossible d'ajouter ce membre.");
  return { reactivated: Boolean(body?.reactivated) };
}

async function removeMember(teamId: string, userId: string) {
  const response = await authFetch(`/api/teams/web/${teamId}/members/${userId}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Impossible de retirer ce membre.');
  }
}

function MetricCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
    </article>
  );
}

function LoadingState() {
  return <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />;
}
