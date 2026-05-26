import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  createDocumentAttachment,
  jsonDocumentError,
  listDocumentAttachments,
  parseCreateDocumentFormData,
  parseDocumentListQuery,
} from '@/lib/documents';

export const GET = withAuth(async ({ req, user }) => {
  const context = parseDocumentListQuery(new URL(req.url).searchParams);

  if (!context) {
    return jsonDocumentError('BAD_REQUEST', 400, 'Contexte document invalide.');
  }

  const documents = await listDocumentAttachments(prisma, { user, context });
  if (!documents) {
    return jsonDocumentError('FORBIDDEN', 403, 'Consultation des documents non autorisee.');
  }

  return Response.json(documents);
});

export const POST = withAuth(async ({ req, user }) => {
  const parsed = await parseCreateDocumentFormData(req);

  if ('error' in parsed) {
    if (parsed.error === 'PAYLOAD_TOO_LARGE') {
      return jsonDocumentError('PAYLOAD_TOO_LARGE', 413, 'Le fichier depasse la taille maximale autorisee de 20 Mo.');
    }

    if (parsed.error === 'UNSUPPORTED_FORMAT') {
      return jsonDocumentError('UNSUPPORTED_FORMAT', 400, 'Format de fichier non autorise.');
    }

    return jsonDocumentError('BAD_REQUEST', 400, 'Le payload document est invalide.');
  }

  const result = await createDocumentAttachment(prisma, {
    user,
    file: parsed.file,
    context: parsed.context,
  });

  if (result.code === 'FORBIDDEN') {
    return jsonDocumentError('FORBIDDEN', 403, "Vous n'avez pas acces a ce contexte document.");
  }

  if (result.code === 'UPLOAD_FAILED') {
    return jsonDocumentError('UPLOAD_FAILED', 500, "L'upload prive du document a echoue.");
  }

  return Response.json({ document: result.document }, { status: 201 });
});
