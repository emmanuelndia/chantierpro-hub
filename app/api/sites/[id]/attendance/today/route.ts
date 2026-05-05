import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canReadProjects, getScopedSiteById } from '@/lib/projects';
import { getAttendanceToday, jsonClockInError } from '@/lib/clock-in';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canReadProjects(user.role)) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Acces refuse a la consultation des presences du jour.',
    );
  }

  const site = await getScopedSiteById(prisma, params.id, user);

  if (!site) {
    return jsonClockInError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const attendance = await getAttendanceToday(prisma, site.id);
  return Response.json(attendance);
});
