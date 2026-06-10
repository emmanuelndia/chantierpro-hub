import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { searchNegotiationBuildings } from '@/lib/negotiation';

export const GET = withAuth(async ({ req, user }) => {
  const searchParams = new URL(req.url).searchParams;
  const projectId = searchParams.get('projectId') ?? '';
  const q = searchParams.get('q') ?? '';

  if (!projectId) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Projet obligatoire.' }, { status: 400 });
  }

  return searchNegotiationBuildings(prisma, user, projectId, q);
});
