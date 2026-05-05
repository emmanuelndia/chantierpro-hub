import { withAuth } from '@/lib/auth/with-auth';
import { searchMapboxAddress } from '@/lib/project-web';
import { canWriteProjects, jsonProjectError } from '@/lib/projects';

export const GET = withAuth(async ({ req, user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, "Acces refuse a la recherche d'adresse.");
  }

  const query = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (query.length < 3) {
    return Response.json({ items: [] });
  }

  return Response.json(await searchMapboxAddress(query));
});
