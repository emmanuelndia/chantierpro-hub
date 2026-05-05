import { withAuth } from '@/lib/auth/with-auth';
import { jsonPhotoError } from '@/lib/photos';

export const POST = withAuth<{ id: string }>(() => {
  return jsonPhotoError('FORBIDDEN', 403, 'Les logs de suppression photo sont immuables.');
});

export const PUT = withAuth<{ id: string }>(() => {
  return jsonPhotoError('FORBIDDEN', 403, 'Les logs de suppression photo sont immuables.');
});

export const PATCH = withAuth<{ id: string }>(() => {
  return jsonPhotoError('FORBIDDEN', 403, 'Les logs de suppression photo sont immuables.');
});

export const DELETE = withAuth<{ id: string }>(() => {
  return jsonPhotoError('FORBIDDEN', 403, 'Les logs de suppression photo sont immuables.');
});
