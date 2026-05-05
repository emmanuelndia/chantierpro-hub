import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';
import { canCreateReports, canReadAllReports, getAccessibleReportById, jsonReportError } from '@/lib/reports';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canCreateReports(user.role) && !canReadAllReports(user.role)) {
    return jsonReportError('FORBIDDEN', 403, 'Consultation du rapport non autorisee.');
  }

  const basePayload = {
    reportId: params.id,
    user,
  };
  const report = await getAccessibleReportById(
    prisma,
    user.role === 'COORDINATOR'
      ? { ...basePayload, siteIds: await getOperationalSiteIds(prisma, user.id) }
      : basePayload,
  );

  if (!report) {
    return jsonReportError('NOT_FOUND', 404, 'Rapport introuvable.');
  }

  return Response.json({ report });
});
