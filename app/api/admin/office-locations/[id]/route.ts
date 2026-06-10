import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { parseJsonBody } from '@/lib/clock-in';
import {
  canManageOfficeLocations,
  parseOfficeLocationPayload,
  updateOfficeLocation,
} from '@/lib/office-locations';

export const PATCH = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canManageOfficeLocations(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Modification bureau refusee.' }, { status: 403 });
  }

  const { id } = params;
  const body = await parseJsonBody<unknown>(req);
  const input = parseOfficeLocationPayload(body);

  if (!input) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Les donnees du bureau sont invalides.' }, { status: 400 });
  }

  try {
    const item = await updateOfficeLocation(prisma, id, input);
    return Response.json({ item });
  } catch {
    return Response.json({ code: 'NOT_FOUND', message: 'Bureau introuvable.' }, { status: 404 });
  }
});
