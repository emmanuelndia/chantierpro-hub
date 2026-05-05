import { ReportValidationStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileManagementReports, getMobileManagementReports } from '@/lib/mobile-management-reports';
import { prisma } from '@/lib/prisma';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessMobileManagementReports(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Accès refusé aux rapports management mobile.' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const status = searchParams.get('status');

  if (status && status !== 'ALL' && !Object.values(ReportValidationStatus).includes(status as ReportValidationStatus)) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Statut de rapport invalide.' }, { status: 400 });
  }

  const payload = await getMobileManagementReports(prisma, user, {
    projectId: searchParams.get('projectId'),
    siteId: searchParams.get('siteId'),
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    status: status as ReportValidationStatus | 'ALL' | null,
    q: searchParams.get('q'),
  });

  return Response.json(payload);
});
