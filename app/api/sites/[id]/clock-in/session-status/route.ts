import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  getActivePause,
  getAccessibleClockInSite,
  getOpenSessionForUser,
  isTechnician,
  jsonClockInError,
  serializeSessionStatus,
} from '@/lib/clock-in';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Seuls les roles terrain peuvent consulter le statut de session.',
    );
  }

  const site = await getAccessibleClockInSite(prisma, params.id, user.id);

  if (!site) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Ce role terrain ne peut pas consulter ce chantier.',
    );
  }

  const openSession = await getOpenSessionForUser(prisma, user.id);
  const activePause = openSession ? await getActivePause(prisma, openSession.siteId, user.id) : null;
  return Response.json(serializeSessionStatus(openSession, activePause));
});
