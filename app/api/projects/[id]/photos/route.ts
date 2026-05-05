import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { jsonPhotoError, listProjectPhotos, parsePhotoListQuery } from '@/lib/photos';

export const GET = withAuth<{ id: string }>(async ({ params, req, user }) => {
  const query = parsePhotoListQuery(new URL(req.url).searchParams);
  const photos = await listProjectPhotos(prisma, {
    projectId: params.id,
    user,
    page: query.page,
    uploadedByIds: query.uploadedByIds,
    category: query.category,
    from: query.from,
    to: query.to,
    sort: query.sort,
  });
  if (!photos) {
    return jsonPhotoError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  return Response.json(photos);
});
