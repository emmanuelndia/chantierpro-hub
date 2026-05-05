import { TeamStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileTeams, getMobileTeamsManagement } from '@/lib/mobile-teams';
import { prisma } from '@/lib/prisma';
import { jsonTeamError } from '@/lib/teams';
import type { MobileTeamStatusFilter } from '@/types/mobile-teams';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Accès refusé à la gestion mobile des équipes.');
  }

  const searchParams = req.nextUrl.searchParams;
  const rawStatus = searchParams.get('status');
  const status =
    rawStatus && Object.values(TeamStatus).includes(rawStatus as TeamStatus)
      ? (rawStatus as MobileTeamStatusFilter)
      : null;

  return Response.json(
    await getMobileTeamsManagement(prisma, user, {
      projectId: searchParams.get('projectId'),
      siteId: searchParams.get('siteId'),
      status,
      q: searchParams.get('q'),
    }),
  );
});
