import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canUploadPhotos,
  jsonPhotoError,
  listSitePhotos,
  parsePhotoListQuery,
} from '@/lib/photos';

export const GET = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canUploadPhotos(user.role)) {
    return jsonPhotoError('FORBIDDEN', 403, 'Consultation des photos non autorisée.');
  }

  const query = parsePhotoListQuery(new URL(req.url).searchParams);
  const photos = await listSitePhotos(prisma, {
    siteId: params.id,
    user,
    page: query.page,
    uploadedByIds: query.uploadedByIds,
    category: query.category,
    from: query.from,
    to: query.to,
    sort: query.sort,
  });

  if (!photos) {
    return jsonPhotoError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  return Response.json(photos);
});
