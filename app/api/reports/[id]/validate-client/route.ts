import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';
import { jsonReportError, validateReportForClient } from '@/lib/reports';

export const POST = withAuth<{ id: string }>(async ({ params, user }) => {
  const siteIds = await getOperationalSiteIds(prisma, user.id);
  const result = await validateReportForClient(prisma, {
    reportId: params.id,
    user,
    siteIds,
  });

  if (result.code === 'FORBIDDEN') {
    return jsonReportError('FORBIDDEN', 403, 'Validation client non autorisee.');
  }

  if (result.code === 'NOT_FOUND') {
    return jsonReportError('NOT_FOUND', 404, 'Rapport introuvable dans votre perimetre.');
  }

  if (result.code === 'ALREADY_VALIDATED') {
    return jsonReportError('ALREADY_VALIDATED', 409, 'Ce rapport est deja valide pour envoi client.');
  }

  return Response.json({ report: result.report });
});
