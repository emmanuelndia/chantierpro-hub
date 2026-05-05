import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canReadPhotoLogs, jsonPhotoError, listPhotoDeletionLogs, parseLogsQuery } from '@/lib/photos';

export const GET = withAuth(async ({ req, user }) => {
  if (!canReadPhotoLogs(user.role)) {
    return jsonPhotoError('FORBIDDEN', 403, 'Consultation des logs photo non autorisee.');
  }

  const query = parseLogsQuery(new URL(req.url).searchParams);
  const logs = await listPhotoDeletionLogs(prisma, query.page);
  return Response.json(logs);
});

export const POST = withAuth(() => {
  return jsonPhotoError('FORBIDDEN', 403, 'Les logs de suppression photo sont immuables.');
});

export const PUT = withAuth(() => {
  return jsonPhotoError('FORBIDDEN', 403, 'Les logs de suppression photo sont immuables.');
});

export const PATCH = withAuth(() => {
  return jsonPhotoError('FORBIDDEN', 403, 'Les logs de suppression photo sont immuables.');
});

export const DELETE = withAuth(() => {
  return jsonPhotoError('FORBIDDEN', 403, 'Les logs de suppression photo sont immuables.');
});
