import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  getActivePause,
  getAccessibleClockInSite,
  getOpenSession,
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

  const openSession = await getOpenSessionForUser(prisma, user.id);
  const currentSiteOpenSession = openSession?.siteId === params.id ? openSession : await getOpenSession(prisma, params.id, user.id);
  const selectedOpenSession = currentSiteOpenSession ?? openSession;
  const site = await getAccessibleClockInSite(prisma, params.id, user.id);
  const isCurrentOutOfPlanningSession = !site && currentSiteOpenSession?.siteId === params.id;

  if (!site && !isCurrentOutOfPlanningSession) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Ce role terrain ne peut pas consulter ce chantier.',
    );
  }

  const activePause = currentSiteOpenSession?.siteId ? await getActivePause(prisma, currentSiteOpenSession.siteId, user.id) : null;
  return Response.json(serializeSessionStatus(selectedOpenSession, activePause));
});
