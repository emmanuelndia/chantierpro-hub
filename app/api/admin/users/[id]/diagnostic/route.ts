import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getAdminUserDiagnostic } from '@/lib/admin-user-diagnostic';

type RouteParams = {
  id: string;
};

export const GET = withAuth<RouteParams>(
  async ({ req, user, params }) => {
    const date = new URL(req.url).searchParams.get('date');
    const diagnostic = await getAdminUserDiagnostic(prisma, {
      adminUserId: user.id,
      targetUserId: params.id,
      dateLabel: date,
    });

    if (!diagnostic) {
      return Response.json({ code: 'NOT_FOUND', message: 'Utilisateur introuvable.' }, { status: 404 });
    }

    return Response.json(diagnostic);
  },
  [Role.ADMIN],
);
