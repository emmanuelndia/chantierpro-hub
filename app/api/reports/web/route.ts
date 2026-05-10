import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessWebReports,
  getWebReports,
  jsonReportError,
  parseWebReportQuery,
} from '@/lib/reports';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessWebReports(user.role)) {
    return jsonReportError('FORBIDDEN', 403, 'Acces refuse aux rapports terrain web.');
  }

  const query = parseWebReportQuery(new URL(req.url).searchParams);

  if (!query) {
    return jsonReportError('BAD_REQUEST', 400, 'Les filtres rapports sont invalides.');
  }

  const reports = await getWebReports(prisma, user, query);

  if (!reports) {
    return jsonReportError('FORBIDDEN', 403, 'Acces refuse aux rapports terrain web.');
  }

  return Response.json(reports);
});
