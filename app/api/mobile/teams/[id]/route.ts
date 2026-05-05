import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessMobileTeams,
  canMutateMobileTeams,
  getMobileTeamDetail,
  getScopedMobileTeamById,
  validateMobileAssignableUserForSite,
} from '@/lib/mobile-teams';
import { prisma } from '@/lib/prisma';
import {
  jsonTeamError,
  parseJsonBody,
  parseUpdateTeamInput,
  serializeTeam,
  syncTeamLeadMembership,
  teamPublicSelect,
} from '@/lib/teams';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canAccessMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Accès refusé au détail d'équipe mobile.");
  }

  const detail = await getMobileTeamDetail(prisma, user, params.id);

  if (!detail) {
    return jsonTeamError('NOT_FOUND', 404, 'Équipe introuvable.');
  }

  return Response.json(detail);
});

export const PATCH = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canMutateMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Accès refusé à la modification d'équipe.");
  }

  const existingTeam = await getScopedMobileTeamById(prisma, params.id, user);

  if (!existingTeam) {
    return jsonTeamError('NOT_FOUND', 404, 'Équipe introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseUpdateTeamInput(body);

  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, "Le payload d'équipe est invalide.");
  }

  const leaderIsValid =
    input.teamLeadId === existingTeam.teamLeadId ||
    (await validateMobileAssignableUserForSite(prisma, user, existingTeam.siteId, input.teamLeadId));

  if (!leaderIsValid) {
    return jsonTeamError('INVALID_TEAM_LEAD', 400, "Le chef d'équipe sélectionné doit être actif, disponible et dans votre périmètre.");
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

  return Response.json({ team: serializeTeam(team) });
});
