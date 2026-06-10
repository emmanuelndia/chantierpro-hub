import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessNegotiation, listNegotiationOverview } from '@/lib/negotiation';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse au suivi negociation.' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const filters: { projectId?: string; resourceId?: string; status?: string; q?: string } = {};
  const projectId = searchParams.get('projectId');
  const resourceId = searchParams.get('resourceId');
  const status = searchParams.get('status');
  const q = searchParams.get('q');

  if (projectId) filters.projectId = projectId;
  if (resourceId) filters.resourceId = resourceId;
  if (status) filters.status = status;
  if (q) filters.q = q;

  return Response.json(await listNegotiationOverview(prisma, user, date, filters));
});
