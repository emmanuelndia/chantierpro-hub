import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getClientIp } from '@/lib/auth/http';
import { parseJsonBody } from '@/lib/clock-in';
import {
  buildRhExportArtifact,
  canAccessRh,
  jsonRhError,
  logRhExport,
  parseRhExportInput,
} from '@/lib/rh';
import { checkMemoryRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const POST = withAuth(async ({ req, user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, "Acces refuse a l'export RH.");
  }

  const limitState = checkMemoryRateLimit({
    key: `rh-export:${user.id}:${getClientIp(req.headers)}`,
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (limitState.limited) {
    return rateLimitResponse(limitState.retryAfterSeconds);
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseRhExportInput(body);

  if (!input) {
    return jsonRhError('BAD_REQUEST', 400, "Le payload d'export RH est invalide.");
  }

  try {
    const artifact = await buildRhExportArtifact(prisma, {
      createdBy: user,
      input,
    });

    await logRhExport(prisma, {
      createdById: user.id,
      input,
      rowCount: artifact.rowCount,
      storageKey: artifact.storageKey,
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      expiresAt: artifact.expiresAt,
    });

    return new Response(Uint8Array.from(artifact.buffer), {
      status: 200,
      headers: {
        'content-type': artifact.contentType,
        'content-disposition': `attachment; filename="${artifact.fileName}"`,
      },
    });
  } catch {
    return jsonRhError('EXPORT_FAILED', 500, "La generation de l'export RH a echoue.");
  }
});
