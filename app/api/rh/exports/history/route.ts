import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessRh, getRhExportHistory, jsonRhError } from '@/lib/rh';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, "Acces refuse a l'historique des exports RH.");
  }

  const response = await getRhExportHistory(prisma);
  return Response.json(response);
});
