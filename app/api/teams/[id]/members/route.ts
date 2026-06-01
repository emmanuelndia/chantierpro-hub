import { NextResponse } from 'next/server';
import { TeamMemberStatus, TeamRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageTeams,
  getScopedTeamById,
  jsonTeamError,
  parseAddTeamMemberInput,
  parseJsonBody,
  serializeTeamMember,
  syncTeamLeadMembership,
  teamMemberPublicSelect,
  upsertActiveTeamMember,
  validateActiveTechnician,
} from '@/lib/teams';

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canManageTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse a l'ajout de membre.");
  }

  const team = await getScopedTeamById(prisma, params.id, user);

  if (!team) {
    return jsonTeamError('NOT_FOUND', 404, 'Equipe introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseAddTeamMemberInput(body);

  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, 'Le payload membre est invalide.');
  }

  const memberIsValid = await validateActiveTechnician(prisma, input.userId);

  if (!memberIsValid) {
    return jsonTeamError(
      'INVALID_MEMBER',
      400,
      'Le membre selectionne doit etre une ressource externe active.',
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const upserted = await upsertActiveTeamMember(tx, {
      teamId: team.id,
      userId: input.userId,
      teamRole: input.teamRole,
      createdById: user.id,
    });

    if (upserted.status === 'active_exists') {
      return upserted;
    }

    if (input.teamRole === TeamRole.TEAM_LEAD) {
      await tx.team.update({
        where: { id: team.id },
        data: {
          teamLeadId: input.userId,
        },
      });

      await syncTeamLeadMembership(tx, {
        teamId: team.id,
        teamLeadId: input.userId,
        createdById: user.id,
      });

      return tx.teamMember.findFirstOrThrow({
        where: {
          teamId: team.id,
          userId: input.userId,
          status: TeamMemberStatus.ACTIVE,
        },
        orderBy: [{ assignmentDate: 'desc' }, { id: 'desc' }],
        select: teamMemberPublicSelect,
      }).then((member) => ({ ...upserted, member }));
    }

    return upserted;
  });

  if (result.status === 'active_exists') {
    return jsonTeamError(
      'CONFLICT',
      409,
      'Cet utilisateur est deja membre actif de cette equipe.',
    );
  }

  return NextResponse.json(
    { member: serializeTeamMember(result.member) },
    { status: result.status === 'created' ? 201 : 200 },
  );
});
