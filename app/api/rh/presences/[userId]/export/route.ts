import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  buildRhUserPresenceDetailExport,
  canAccessRh,
  jsonRhError,
  parseUserPresenceQuery,
} from '@/lib/rh';

export const GET = withAuth<{ userId: string }>(async ({ params, req, user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse a l export du detail RH.');
  }

  const searchParams = new URL(req.url).searchParams;
  const format = parseDetailExportFormat(searchParams.get('format'));
  if (!format) {
    return jsonRhError('BAD_REQUEST', 400, 'Format export invalide.');
  }

  const artifact = await buildRhUserPresenceDetailExport(prisma, {
    userId: params.userId,
    query: parseUserPresenceQuery(searchParams),
    format,
  });

  if (!artifact) {
    return jsonRhError('NOT_FOUND', 404, 'Utilisateur introuvable.');
  }

  return new Response(Uint8Array.from(artifact.buffer), {
    status: 200,
    headers: {
      'content-type': artifact.contentType,
      'content-disposition': `attachment; filename="${artifact.fileName}"`,
    },
  });
});

function parseDetailExportFormat(value: string | null) {
  return value === 'xlsx' || value === 'pdf' ? value : null;
}