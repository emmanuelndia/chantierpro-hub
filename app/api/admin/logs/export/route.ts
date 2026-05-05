import { withAuth } from '@/lib/auth/with-auth';
import { prisma } from '@/lib/prisma';
import {
  buildAdminDeletionLogsCsv,
  canAccessAdminLogs,
  jsonAdminLogsError,
  parseAdminLogsExportInput,
} from '@/lib/photos';

export const POST = withAuth(async ({ req, user }) => {
  if (!canAccessAdminLogs(user.role)) {
    return jsonAdminLogsError('FORBIDDEN', 403, "Acces refuse a l'export des logs d'administration.");
  }

  const input = await parseAdminLogsExportInput(req);

  if (!input) {
    return jsonAdminLogsError('BAD_REQUEST', 400, "Le payload d'export des logs admin est invalide.");
  }

  try {
    const artifact = await buildAdminDeletionLogsCsv(prisma, input);

    return new Response(Uint8Array.from(artifact.buffer), {
      status: 200,
      headers: {
        'content-type': artifact.contentType,
        'content-disposition': `attachment; filename="${artifact.fileName}"`,
      },
    });
  } catch {
    return jsonAdminLogsError('EXPORT_FAILED', 500, "La generation de l'export des logs admin a echoue.");
  }
});
