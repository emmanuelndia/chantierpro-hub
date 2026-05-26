import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { jsonDocumentError, softDeleteDocumentAttachment } from '@/lib/documents';

export const DELETE = withAuth<{ id: string }>(async ({ params, req, user }) => {
  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  if (!reason) {
    return jsonDocumentError('BAD_REQUEST', 400, 'Le motif de suppression est obligatoire.');
  }

  const result = await softDeleteDocumentAttachment(prisma, {
    documentId: params.id,
    user,
    reason,
  });

  if (result.code === 'NOT_FOUND') {
    return jsonDocumentError('NOT_FOUND', 404, 'Document introuvable.');
  }

  if (result.code === 'FORBIDDEN') {
    return jsonDocumentError('FORBIDDEN', 403, 'Suppression de document non autorisee.');
  }

  if (result.code === 'DELETE_FAILED') {
    return jsonDocumentError('DELETE_FAILED', 500, 'La suppression physique du fichier a echoue.');
  }

  return Response.json({ document: result.document });
});
