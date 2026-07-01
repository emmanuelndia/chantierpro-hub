import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessDirectionAttendanceReport, getDirectionAttendanceReport, jsonRhError } from '@/lib/rh';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessDirectionAttendanceReport(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse au rapport Direction.');
  }

  const searchParams = new URL(req.url).searchParams;
  const dateParam = searchParams.get('date');
  const date = dateParam ? new Date(`${dateParam}T00:00:00.000Z`) : new Date();

  if (Number.isNaN(date.getTime())) {
    return jsonRhError('BAD_REQUEST', 400, 'Date invalide.');
  }

  return Response.json(await getDirectionAttendanceReport(prisma, date));
});