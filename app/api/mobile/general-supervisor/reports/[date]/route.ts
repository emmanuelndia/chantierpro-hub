import { ReportValidationStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessGeneralSupervisorReports, getGeneralSupervisorReports } from '@/lib/mobile-general-supervisor-reports';
import { prisma } from '@/lib/prisma';

export const GET = withAuth<{ date: string }>(async ({ params, req, user }) => {
  if (!canAccessGeneralSupervisorReports(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Accès refusé aux rapports du général superviseur.' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const status = searchParams.get('status');

  if (status && status !== 'ALL' && !Object.values(ReportValidationStatus).includes(status as ReportValidationStatus)) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Statut de rapport invalide.' }, { status: 400 });
  }

  const payload = await getGeneralSupervisorReports(prisma, user, {
    date: params.date,
    siteId: searchParams.get('siteId'),
    supervisorId: searchParams.get('supervisorId'),
    status: status as ReportValidationStatus | 'ALL' | null,
    q: searchParams.get('q'),
  });

  return Response.json(payload);
});
