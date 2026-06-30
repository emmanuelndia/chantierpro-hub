import { withAuth } from '@/lib/auth/with-auth';
import {
  canMutateMobileTeams,
  getScopedMobileSiteForTeams,
  getScopedMobileTeamById,
  validateMobileAssignableUserForSite,
} from '@/lib/mobile-teams';
import { prisma } from '@/lib/prisma';
import {
  jsonTeamError,
  parseCreateTeamAssignmentInput,
  parseJsonBody,
  reassignTeam,
  serializeTeamAssignment,
  TeamAssignmentConflictError,
} from '@/lib/teams';

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canMutateMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse au deplacement d'equipe.");
  }

  const team = await getScopedMobileTeamById(prisma, params.id, user);
  if (!team) {
    return jsonTeamError('NOT_FOUND', 404, 'Equipe introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseCreateTeamAssignmentInput(body);
  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, "Le payload d'affectation est invalide.");
  }

  const site = await getScopedMobileSiteForTeams(prisma, input.siteId, user);
  if (!site) {
    return jsonTeamError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const supervisorIsValid = await validateMobileAssignableUserForSite(prisma, user, site.id, input.supervisorId);
  if (!supervisorIsValid) {
    return jsonTeamError('INVALID_TEAM_LEAD', 400, "Le superviseur selectionne doit etre une ressource externe active.");
  }

  try {
    const assignment = await prisma.$transaction((tx) =>
      reassignTeam(tx, {
        teamId: team.id,
        siteId: site.id,
        supervisorId: input.supervisorId,
        startDate: new Date(`${input.startDate}T00:00:00.000Z`),
        createdById: user.id,
      }),
    );

    return Response.json({ assignment: serializeTeamAssignment(assignment) }, { status: 201 });
  } catch (error) {
    if (error instanceof TeamAssignmentConflictError) {
      return jsonTeamError('CONFLICT', 409, 'Cette date chevauche une affectation existante.');
    }

    throw error;
  }
});