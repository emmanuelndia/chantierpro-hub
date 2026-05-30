import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canCreateReports, canReadAllReports, getAccessibleReportById, jsonReportError } from '@/lib/reports';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canCreateReports(user.role) && !canReadAllReports(user.role)) {
    return jsonReportError('FORBIDDEN', 403, 'Consultation du rapport non autorisee.');
  }

  const report = await getAccessibleReportById(prisma, {
    reportId: params.id,
    user,
  });

  if (!report) {
    return jsonReportError('NOT_FOUND', 404, 'Rapport introuvable.');
  }

  return Response.json({ report });
});
