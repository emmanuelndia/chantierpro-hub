import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthUserFromRequest } from '@/lib/auth/request-user';
import { createSignedStorageUrl } from '@/lib/storage';
import { getAccessiblePhotoStorageById, jsonPhotoError } from '@/lib/photos';

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const user = await getAuthUserFromRequest(req);

  if (!user) {
    return jsonPhotoError('UNAUTHORIZED', 401, 'Authentification requise.');
  }

  const params = await context.params;
  const photo = await getAccessiblePhotoStorageById(prisma, {
    photoId: params.id,
    user,
  });

  if (!photo) {
    return jsonPhotoError('NOT_FOUND', 404, 'Photo introuvable.');
  }

  let signedUrl: string;

  try {
    signedUrl = await createSignedStorageUrl(photo.storageKey);
  } catch (error) {
    console.error('Unable to create signed photo URL:', params.id, error);
    return jsonPhotoError(
      'STORAGE_SIGNED_URL_FAILED',
      500,
      "Impossible de générer l'URL de la photo.",
    );
  }

  try {
    const response = await fetch(signedUrl, { cache: 'no-store' });

    if (!response.ok || !response.body) {
      return jsonPhotoError('STORAGE_SIGNED_URL_FAILED', 502, 'Impossible de charger la photo.');
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Content-Type': response.headers.get('content-type') ?? 'image/jpeg',
      },
    });
  } catch (error) {
    console.error('Unable to stream signed photo:', params.id, error);
    return jsonPhotoError('STORAGE_SIGNED_URL_FAILED', 502, 'Impossible de charger la photo.');
  }
}
