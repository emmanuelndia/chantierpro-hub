import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthUserFromRequest } from '@/lib/auth/request-user';
import { getAccessibleDocumentStorageById, jsonDocumentError, streamDocumentContent } from '@/lib/documents';

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const user = await getAuthUserFromRequest(req);

  if (!user) {
    return jsonDocumentError('FORBIDDEN', 401, 'Authentification requise.');
  }

  const params = await context.params;
  const document = await getAccessibleDocumentStorageById(prisma, {
    documentId: params.id,
    user,
  });

  if (!document) {
    return jsonDocumentError('NOT_FOUND', 404, 'Document introuvable.');
  }

  try {
    const response = await streamDocumentContent(document);
    if (!response) {
      return jsonDocumentError('STORAGE_FAILED', 502, 'Impossible de charger le document.');
    }

    return response;
  } catch (error) {
    console.error('Unable to stream private document:', params.id, error);
    return jsonDocumentError('STORAGE_FAILED', 502, 'Impossible de charger le document.');
  }
}
