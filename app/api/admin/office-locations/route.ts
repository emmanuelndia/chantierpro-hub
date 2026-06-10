import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { parseJsonBody } from '@/lib/clock-in';
import {
  canManageOfficeLocations,
  createOfficeLocation,
  listOfficeLocations,
  parseOfficeLocationPayload,
} from '@/lib/office-locations';

export const GET = withAuth(async ({ user }) => {
  if (!canManageOfficeLocations(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux bureaux.' }, { status: 403 });
  }

  return Response.json(await listOfficeLocations(prisma));
});

export const POST = withAuth(async ({ req, user }) => {
  if (!canManageOfficeLocations(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Creation bureau refusee.' }, { status: 403 });
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseOfficeLocationPayload(body);

  if (!input) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Les donnees du bureau sont invalides.' }, { status: 400 });
  }

  const item = await createOfficeLocation(prisma, {
    ...input,
    createdById: user.id,
  });

  return Response.json({ item }, { status: 201 });
});
