import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@prisma/client';
import { REFRESH_COOKIE_NAME } from '@/lib/auth/constants';
import { prisma } from '@/lib/prisma';
import { verifyRefreshToken } from '@/lib/auth/tokens';

export type WebSessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  mustChangePassword: boolean;
};

export async function getCurrentWebSession() {
  const refreshCookie = (await cookies()).get(REFRESH_COOKIE_NAME)?.value;

  if (!refreshCookie) {
    return null;
  }

  try {
    const payload = await verifyRefreshToken(refreshCookie);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
      },
    });

    if (!user?.isActive) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    } satisfies WebSessionUser;
  } catch {
    return null;
  }
}

export async function getRequiredWebSession() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/login');
  }

  return session;
}
