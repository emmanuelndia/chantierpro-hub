import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canDeletePhotos,
  getAccessiblePhotoById,
  jsonPhotoError,
  parseDeletePhotoInput,
  softDeletePhoto,
} from '@/lib/photos';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  const photo = await getAccessiblePhotoById(prisma, {
    photoId: params.id,
    user,
  });

  if (!photo) {
    return jsonPhotoError('NOT_FOUND', 404, 'Photo introuvable.');
  }

  return Response.json({
    photo,
    url: photo.url,
  });
});

export const DELETE = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canDeletePhotos(user.role)) {
    return jsonPhotoError('FORBIDDEN', 403, 'Suppression de photo non autorisee.');
  }

  const input = await parseDeletePhotoInput(req);

  if (!input) {
    return jsonPhotoError('BAD_REQUEST', 400, 'La raison de suppression est obligatoire.');
  }

  const result = await softDeletePhoto(prisma, {
    photoId: params.id,
    user,
    reason: input.reason,
  });

  if (result.code === 'NOT_FOUND') {
    return jsonPhotoError('NOT_FOUND', 404, 'Photo introuvable.');
  }

  if (result.code === 'FORBIDDEN') {
    return jsonPhotoError('FORBIDDEN', 403, 'Suppression de photo non autorisee.');
  }

  if (result.code === 'DELETE_FAILED') {
    return jsonPhotoError('DELETE_FAILED', 500, 'La suppression physique du fichier a echoue.');
  }

  return Response.json({ photo: result.photo });
});
