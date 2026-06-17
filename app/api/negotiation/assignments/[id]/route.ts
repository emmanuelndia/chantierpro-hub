import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { deleteNegotiationAssignment } from '@/lib/negotiation';

export const DELETE = withAuth<{ id: string }>(async ({ user, params }) => {
  return deleteNegotiationAssignment(prisma, user, params.id);
});
