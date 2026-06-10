import { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessRh, jsonRhError } from '@/lib/rh';

const excludedRoles: Role[] = [Role.ADMIN, Role.DIRECTION, Role.HR];

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse a la liste des ressources RH.');
  }

  const searchParams = req.nextUrl.searchParams;
  const q = searchParams.get('q')?.trim();
  const role = parseRole(searchParams.get('role'));

  const where: Prisma.UserWhereInput = {
    isActive: true,
    role: role ?? { notIn: excludedRoles },
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            { username: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { matricule: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [items, missingMatricule, roles] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      take: 500,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        matricule: true,
        role: true,
      },
    }),
    prisma.user.count({
      where: {
        isActive: true,
        role: { notIn: excludedRoles },
        OR: [{ matricule: null }, { matricule: '' }],
      },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { notIn: excludedRoles },
      },
      distinct: ['role'],
      select: { role: true },
      orderBy: { role: 'asc' },
    }),
  ]);

  return Response.json({
    items,
    totalItems: items.length,
    missingMatricule,
    roles: roles.map((item) => item.role),
  });
});

function parseRole(value: string | null) {
  if (!value) return null;
  return Object.values(Role).includes(value as Role) ? (value as Role) : null;
}
