import { NextResponse } from 'next/server';
import { TeamStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageTeams,
  getScopedSiteByIdForTeams,
  jsonTeamError,
  parseCreateTeamInput,
  parseJsonBody,
  serializeTeam,
  syncTeamLeadMembership,
  teamPublicSelect,
  validateActiveTechnician,
} from '@/lib/teams';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canManageTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse a la lecture des equipes.");
  }

  const site = await getScopedSiteByIdForTeams(prisma, params.id, user);

  if (!site) {
    return jsonTeamError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const teams = await prisma.team.findMany({
    where: {
      siteId: site.id,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: teamPublicSelect,
  });

  return NextResponse.json({
    items: teams.map(serializeTeam),
  });
});

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canManageTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse a la creation d'equipe.");
  }

  const site = await getScopedSiteByIdForTeams(prisma, params.id, user);

  if (!site) {
    return jsonTeamError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseCreateTeamInput(body);

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
    const created = await tx.team.create({
      data: {
        name: input.name,
        siteId: site.id,
        teamLeadId: input.teamLeadId,
        status: input.status ?? TeamStatus.ACTIVE,
        createdById: user.id,
      },
      select: {
        id: true,
      },
    });

    await syncTeamLeadMembership(tx, {
      teamId: created.id,
      teamLeadId: input.teamLeadId,
      createdById: user.id,
    });

    return tx.team.findUniqueOrThrow({
      where: {
        id: created.id,
      },
      select: teamPublicSelect,
    });
  });

  return NextResponse.json({ team: serializeTeam(team) }, { status: 201 });
});
