import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  buildWebReportsExport,
  canAccessWebReports,
  jsonReportError,
  parseWebReportExportFormat,
  parseWebReportQuery,
} from '@/lib/reports';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessWebReports(user.role)) {
    return jsonReportError('FORBIDDEN', 403, 'Export des rapports terrain web non autorise.');
  }

  const searchParams = new URL(req.url).searchParams;
  const query = parseWebReportQuery(searchParams);
  const format = parseWebReportExportFormat(searchParams.get('format'));

  if (!query || !format) {
    return jsonReportError('BAD_REQUEST', 400, "Les parametres d'export sont invalides.");
  }

  try {
    const artifact = await buildWebReportsExport(prisma, user, query, format);

    if (!artifact) {
      return jsonReportError('FORBIDDEN', 403, 'Export des rapports terrain web non autorise.');
    }

    return new Response(artifact.body, {
      headers: {
        'Content-Type': artifact.contentType,
        'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
      },
    });
  } catch {
    return jsonReportError('EXPORT_FAILED', 500, "La generation de l'export rapports a echoue.");
  }
});
