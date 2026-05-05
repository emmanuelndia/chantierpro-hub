import { TeamMemberStatus, TeamRole } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { canMutateMobileTeams, getScopedMobileTeamById, validateMobileAssignableUserForSite } from '@/lib/mobile-teams';
import { prisma } from '@/lib/prisma';
import {
  hasActiveMember,
  jsonTeamError,
  parseAddTeamMemberInput,
  parseJsonBody,
  serializeTeamMember,
  syncTeamLeadMembership,
  teamMemberPublicSelect,
} from '@/lib/teams';

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canMutateMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Accès refusé à l'ajout de membre.");
  }

  const team = await getScopedMobileTeamById(prisma, params.id, user);

  if (!team) {
    return jsonTeamError('NOT_FOUND', 404, 'Équipe introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseAddTeamMemberInput(body);

  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, 'Le payload membre est invalide.');
  }

  const memberIsValid = await validateMobileAssignableUserForSite(prisma, user, team.siteId, input.userId);

  if (!memberIsValid) {
    return jsonTeamError('INVALID_MEMBER', 400, 'Le membre sélectionné doit être actif, disponible et dans votre périmètre.');
  }

  if (await hasActiveMember(prisma, team.id, input.userId)) {
    return jsonTeamError('CONFLICT', 409, 'Cet utilisateur est déjà membre actif de cette équipe.');
  }

  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.teamMember.create({
      data: {
        teamId: team.id,
        userId: input.userId,
        teamRole: input.teamRole,
        assignmentDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        status: TeamMemberStatus.ACTIVE,
        createdById: user.id,
      },
      select: teamMemberPublicSelect,
    });

    if (input.teamRole !== TeamRole.TEAM_LEAD) {
      return created;
    }

    await tx.team.update({
      where: { id: team.id },
      data: { teamLeadId: input.userId },
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
    });
  });

  return Response.json({ member: serializeTeamMember(member) }, { status: 201 });
});
