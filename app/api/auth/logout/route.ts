import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { REFRESH_COOKIE_NAME } from '@/lib/auth/constants';
import { createExpiredRefreshCookie } from '@/lib/auth/cookies';
import { hashToken } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  const refreshCookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (refreshCookie) {
    await prisma.refreshToken.updateMany({
      where: {
        tokenHash: hashToken(refreshCookie),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(createExpiredRefreshCookie());
  return response;
}
