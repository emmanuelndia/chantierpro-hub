import type { NextRequest } from 'next/server';
import type { Role } from '@prisma/client';
import { REFRESH_COOKIE_NAME } from '@/lib/auth/constants';
import { prisma } from '@/lib/prisma';
import { authUserSelect, serializeAuthUser } from '@/lib/auth/serializers';
import { hashToken } from '@/lib/auth/session';
import { verifyAccessToken, verifyRefreshToken } from '@/lib/auth/tokens';

export type RequestAuthUser = ReturnType<typeof serializeAuthUser>;
export type RequestAuthFailureCode = 'NO_SESSION' | 'TOKEN_EXPIRED' | 'ROLE_FORBIDDEN';

export type RequestAuthResult =
  | {
      ok: true;
      source: 'bearer' | 'cookie';
      user: RequestAuthUser;
    }
  | {
      code: RequestAuthFailureCode;
      ok: false;
    };

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
    return { code: 'NO_SESSION' as const, user: null };
  }

  const token = authorization.slice('Bearer '.length);
  try {
    const payload = await verifyAccessToken(token);
    const user = await getUserById(payload.sub);

    return user
      ? { source: 'bearer' as const, user }
      : { code: 'NO_SESSION' as const, user: null };
  } catch {
    return { code: 'TOKEN_EXPIRED' as const, user: null };
  }
}

async function getUserFromRefreshCookie(req: NextRequest) {
  const refreshCookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (!refreshCookie) {
    return { code: 'NO_SESSION' as const, user: null };
  }

  try {
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
      return { code: 'TOKEN_EXPIRED' as const, user: null };
    }

    return {
      source: 'cookie' as const,
      user: serializeAuthUser(existingToken.user),
    };
  } catch {
    return { code: 'TOKEN_EXPIRED' as const, user: null };
  }
}

export async function getAuthResultFromRequest(
  req: NextRequest,
  roles: Role[] = [],
): Promise<RequestAuthResult> {
  const bearerResult = await getUserFromAuthorizationHeader(req);
  const cookieResult = bearerResult.user ? null : await getUserFromRefreshCookie(req);
  const authResult = bearerResult.user ? bearerResult : cookieResult;

  if (!authResult?.user) {
    return {
      code:
        bearerResult.code === 'TOKEN_EXPIRED' || cookieResult?.code === 'TOKEN_EXPIRED'
          ? 'TOKEN_EXPIRED'
          : 'NO_SESSION',
      ok: false,
    };
  }

  if (roles.length > 0 && !roles.includes(authResult.user.role)) {
    return { code: 'ROLE_FORBIDDEN', ok: false };
  }

  return {
    ok: true,
    source: authResult.source,
    user: authResult.user,
  };
}

export async function getAuthUserFromRequest(req: NextRequest, roles: Role[] = []) {
  const result = await getAuthResultFromRequest(req, roles);

  if (!result.ok) {
    return null;
  }

  return result.user;
}
