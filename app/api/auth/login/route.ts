import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createRefreshCookie } from '@/lib/auth/cookies';
import { jsonError, getClientIp } from '@/lib/auth/http';
import { verifyPassword } from '@/lib/auth/password';
import { getLoginRateLimitState, recordLoginAttempt, clearLoginAttempts } from '@/lib/auth/rate-limit';
import { authUserSelect } from '@/lib/auth/serializers';
import { createSessionTokens } from '@/lib/auth/session';

type LoginRequestBody = {
  email?: string;
  password?: string;
};

export async function POST(req: NextRequest) {
  let body: LoginRequestBody = {};

  try {
    body = JSON.parse(await req.text()) as LoginRequestBody;
  } catch {
    body = {};
  }

  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';
  const ipAddress = getClientIp(req.headers);

  if (!email || !password) {
    return jsonError('INVALID_CREDENTIALS', 401);
  }

  const limitState = await getLoginRateLimitState(prisma, email, ipAddress);

  if (limitState.blocked) {
    return NextResponse.json(
      {
        code: 'TOO_MANY_ATTEMPTS',
        retryAfterSeconds: limitState.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(limitState.retryAfterSeconds),
        },
      },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      ...authUserSelect,
      passwordHash: true,
    },
  });

  const passwordMatches = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordMatches) {
    await recordLoginAttempt(prisma, {
      emailOrKey: email,
      ipAddress,
      success: false,
      ...(user ? { userId: user.id } : {}),
    });

    return jsonError('INVALID_CREDENTIALS', 401);
  }

  if (!user.isActive) {
    await recordLoginAttempt(prisma, {
      emailOrKey: email,
      ipAddress,
      success: false,
      userId: user.id,
    });

    return jsonError('ACCOUNT_DISABLED', 403);
  }

  await clearLoginAttempts(prisma, email, ipAddress);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
    },
  });

  const session = await createSessionTokens(prisma, user, {
    ipAddress,
    userAgent: req.headers.get('user-agent'),
  });

  await recordLoginAttempt(prisma, {
    emailOrKey: email,
    ipAddress,
    success: true,
    userId: user.id,
  });

  const response = NextResponse.json({
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    user: session.user,
  });

  response.cookies.set(createRefreshCookie(session.refreshToken));

  return response;
}
