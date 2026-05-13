import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthUserFromRequest } from '@/lib/auth/request-user';
import { fetchPrivateStorageObject } from '@/lib/storage';
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

  if (photo.url.startsWith('mock-storage://')) {
    console.error('Photo was saved with mock storage and cannot be streamed:', {
      photoId: params.id,
    });
    return jsonPhotoError('STORAGE_SIGNED_URL_FAILED', 502, 'Photo non stockee dans R2.');
  }

  try {
    const response = await fetchPrivateStorageObject(photo.storageKey);

    if (!response.ok || !response.body) {
      console.error('Unable to load private photo object:', {
        photoId: params.id,
        storageStatus: response.status,
        storageContentType: response.headers.get('content-type'),
      });
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
    console.error('Unable to stream private photo:', params.id, error);
    return jsonPhotoError('STORAGE_SIGNED_URL_FAILED', 502, 'Impossible de charger la photo.');
  }
}
