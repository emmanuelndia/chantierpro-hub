import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageTeams,
  getScopedTeamById,
  jsonTeamError,
  parseJsonBody,
  parseUpdateTeamInput,
  serializeTeam,
  syncTeamLeadMembership,
  teamPublicSelect,
  validateActiveTechnician,
} from '@/lib/teams';

export const PUT = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canManageTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse a la modification d'equipe.");
  }

  const existingTeam = await getScopedTeamById(prisma, params.id, user);

  if (!existingTeam) {
    return jsonTeamError('NOT_FOUND', 404, 'Equipe introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseUpdateTeamInput(body);

  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, "Le payload d'equipe est invalide.");
  }

  const leaderIsValid = await validateActiveTechnician(prisma, input.teamLeadId);

  if (!leaderIsValid) {
    return jsonTeamError(
      'INVALID_TEAM_LEAD',
      400,
      "Le chef d'equipe selectionne doit etre un technicien actif.",
    );
  }

  const team = await prisma.$transaction(async (tx) => {
    await tx.team.update({
      where: { id: params.id },
      data: {
        name: input.name,
        teamLeadId: input.teamLeadId,
        status: input.status,
      },
    });

    await syncTeamLeadMembership(tx, {
      teamId: params.id,
      teamLeadId: input.teamLeadId,
      createdById: user.id,
    });

    return tx.team.findUniqueOrThrow({
      where: { id: params.id },
      select: teamPublicSelect,
    });
  });

  return NextResponse.json({ team: serializeTeam(team) });
});
