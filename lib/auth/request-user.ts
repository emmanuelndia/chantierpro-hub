import type { NextRequest } from 'next/server';
import type { Role } from '@prisma/client';
import { REFRESH_COOKIE_NAME } from '@/lib/auth/constants';
import { prisma } from '@/lib/prisma';
import { authUserSelect, serializeAuthUser } from '@/lib/auth/serializers';
import { hashToken } from '@/lib/auth/session';
import { verifyAccessToken, verifyRefreshToken } from '@/lib/auth/tokens';

export type RequestAuthUser = ReturnType<typeof serializeAuthUser>;

async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: authUserSelect,
  });

  if (!user?.isActive) {
    return null;
  }

  return serializeAuthUser(user);
}

async function getUserFromAuthorizationHeader(req: NextRequest) {
  const authorization = req.headers.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length);
  const payload = await verifyAccessToken(token);

  return getUserById(payload.sub);
}

async function getUserFromRefreshCookie(req: NextRequest) {
  const refreshCookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (!refreshCookie) {
    return null;
  }

  const payload = await verifyRefreshToken(refreshCookie);
  const existingToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshCookie) },
    include: {
      user: {
        select: authUserSelect,
      },
    },
  });

  if (
    !existingToken?.user.isActive ||
    existingToken.id !== payload.tokenId ||
    existingToken.revokedAt !== null ||
    existingToken.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }

  return serializeAuthUser(existingToken.user);
}

export async function getAuthUserFromRequest(req: NextRequest, roles: Role[] = []) {
  try {
    const user = (await getUserFromAuthorizationHeader(req)) ?? (await getUserFromRefreshCookie(req));

    if (!user) {
      return null;
    }

    if (roles.length > 0 && !roles.includes(user.role)) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}
