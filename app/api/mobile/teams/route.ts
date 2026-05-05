import { TeamStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { canMutateMobileTeams, getScopedMobileSiteForTeams, validateMobileAssignableUserForSite } from '@/lib/mobile-teams';
import { prisma } from '@/lib/prisma';
import {
  jsonTeamError,
  parseCreateTeamInput,
  parseJsonBody,
  serializeTeam,
  syncTeamLeadMembership,
  teamPublicSelect,
} from '@/lib/teams';

export const POST = withAuth(async ({ req, user }) => {
  if (!canMutateMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Accès refusé à la création d'équipe.");
  }

  const body = await parseJsonBody<unknown>(req);
  const siteId = getStringField(body, 'siteId');

  if (!siteId) {
    return jsonTeamError('BAD_REQUEST', 400, 'Le chantier est requis.');
  }

  const site = await getScopedMobileSiteForTeams(prisma, siteId, user);

  if (!site) {
    return jsonTeamError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const input = parseCreateTeamInput(body);

  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, "Le payload d'équipe est invalide.");
  }

  const leaderIsValid = await validateMobileAssignableUserForSite(prisma, user, site.id, input.teamLeadId);

  if (!leaderIsValid) {
    return jsonTeamError('INVALID_TEAM_LEAD', 400, "Le chef d'équipe sélectionné doit être actif, disponible et dans votre périmètre.");
  }

  const team = await prisma.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: {
        name: input.name,
        siteId: site.id,
        teamLeadId: input.teamLeadId,
        status: input.status ?? TeamStatus.ACTIVE,
        createdById: user.id,
      },
      select: { id: true },
    });

    await syncTeamLeadMembership(tx, {
      teamId: created.id,
      teamLeadId: input.teamLeadId,
      createdById: user.id,
    });

    return tx.team.findUniqueOrThrow({
      where: { id: created.id },
      select: teamPublicSelect,
    });
  });

  return Response.json({ team: serializeTeam(team) }, { status: 201 });
});

function getStringField(body: unknown, key: string) {
  if (typeof body !== 'object' || body === null || !(key in body)) {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
