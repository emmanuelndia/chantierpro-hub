import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessAdminLogs,
  jsonAdminLogsError,
  listAdminDeletionLogs,
  parseAdminLogsQuery,
} from '@/lib/photos';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessAdminLogs(user.role)) {
    return jsonAdminLogsError('FORBIDDEN', 403, "Acces refuse aux logs d'administration.");
  }

  const query = parseAdminLogsQuery(new URL(req.url).searchParams);
  const logs = await listAdminDeletionLogs(prisma, query);
  return Response.json(logs);
});
