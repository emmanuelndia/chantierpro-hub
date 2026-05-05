import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { REFRESH_COOKIE_NAME } from '@/lib/auth/constants';
import { createExpiredRefreshCookie, createRefreshCookie } from '@/lib/auth/cookies';
import { getClientIp } from '@/lib/auth/http';
import { authUserSelect } from '@/lib/auth/serializers';
import { createSessionTokens, hashToken } from '@/lib/auth/session';
import { verifyRefreshToken } from '@/lib/auth/tokens';

export async function POST(req: NextRequest) {
  const refreshCookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (!refreshCookie) {
    return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
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

    if (!existingToken?.user.isActive) {
      const unauthorized = NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
      unauthorized.cookies.set(createExpiredRefreshCookie());
      return unauthorized;
    }

    if (
      existingToken.id !== payload.tokenId ||
      existingToken.revokedAt !== null ||
      existingToken.expiresAt.getTime() <= Date.now()
    ) {
      const unauthorized = NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
      unauthorized.cookies.set(createExpiredRefreshCookie());
      return unauthorized;
    }

    await prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: {
        revokedAt: new Date(),
      },
    });

    const session = await createSessionTokens(prisma, existingToken.user, {
      ipAddress: getClientIp(req.headers),
      userAgent: req.headers.get('user-agent'),
    });

    const response = NextResponse.json({
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    });

    response.cookies.set(createRefreshCookie(session.refreshToken));

    return response;
  } catch {
    const unauthorized = NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    unauthorized.cookies.set(createExpiredRefreshCookie());
    return unauthorized;
  }
}
