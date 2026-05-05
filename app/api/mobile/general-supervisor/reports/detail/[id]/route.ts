import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessGeneralSupervisorReports,
  getGeneralSupervisorReportDetail,
} from '@/lib/mobile-general-supervisor-reports';
import { prisma } from '@/lib/prisma';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canAccessGeneralSupervisorReports(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Accès refusé au détail du rapport.' }, { status: 403 });
  }

  const payload = await getGeneralSupervisorReportDetail(prisma, user, params.id);

  if (!payload) {
    return Response.json({ code: 'NOT_FOUND', message: 'Rapport introuvable dans votre périmètre.' }, { status: 404 });
  }

  return Response.json(payload);
});
