import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getClientIp } from '@/lib/auth/http';
import {
  canUploadPhotos,
  createPhoto,
  jsonPhotoError,
  parseCreatePhotoFormData,
} from '@/lib/photos';
import { checkMemoryRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const POST = withAuth(async ({ req, user }) => {
  if (!canUploadPhotos(user.role)) {
    return jsonPhotoError('FORBIDDEN', 403, "Acces refuse a l'upload photo.");
  }

  const limitState = checkMemoryRateLimit({
    key: `photos:${user.id}:${getClientIp(req.headers)}`,
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });

  if (limitState.limited) {
    return rateLimitResponse(limitState.retryAfterSeconds);
  }

  const parsed = await parseCreatePhotoFormData(req);

  if ('error' in parsed) {
    if (parsed.error === 'PAYLOAD_TOO_LARGE') {
      return jsonPhotoError('PAYLOAD_TOO_LARGE', 413, 'La photo depasse la taille maximale autorisee de 10 Mo.');
    }

    return jsonPhotoError('BAD_REQUEST', 400, "Le payload multipart photo est invalide.");
  }

  const result = await createPhoto(prisma, {
    user,
    input: parsed.input,
    file: parsed.file,
  });

  if (result.code === 'FORBIDDEN') {
    return jsonPhotoError('FORBIDDEN', 403, "Acces refuse a ce chantier pour l'upload photo.");
  }

  if (result.code === 'SITE_INACTIVE') {
    return jsonPhotoError('SITE_INACTIVE', 400, 'Ce chantier est inactif.');
  }

  if (result.code === 'UPLOAD_FAILED') {
    return jsonPhotoError('UPLOAD_FAILED', 500, "L'upload prive de la photo a echoue.");
  }

  return Response.json({ photo: result.photo }, { status: 201 });
});
