import type { PrismaClient } from '@prisma/client';
import {
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
} from '@/lib/auth/constants';

const LOGIN_WINDOW_MS = LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000;

function getWindowStart() {
  return new Date(Date.now() - LOGIN_WINDOW_MS);
}

export async function getLoginRateLimitState(
  prisma: PrismaClient,
  emailOrKey: string,
  ipAddress: string,
) {
  const recentFailures = await prisma.loginAttempt.findMany({
    where: {
      emailOrKey,
      ipAddress,
      success: false,
      attemptedAt: {
        gte: getWindowStart(),
      },
    },
    orderBy: {
      attemptedAt: 'asc',
    },
  });

  if (recentFailures.length < LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    return {
      blocked: false,
      retryAfterSeconds: 0,
    };
  }

  const oldestFailure = recentFailures[0];

  if (!oldestFailure) {
    return {
      blocked: false,
      retryAfterSeconds: 0,
    };
  }

  const retryAt = oldestFailure.attemptedAt.getTime() + LOGIN_WINDOW_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));

  return {
    blocked: retryAfterSeconds > 0,
    retryAfterSeconds,
  };
}

export async function recordLoginAttempt(
  prisma: PrismaClient,
  payload: {
    emailOrKey: string;
    ipAddress: string;
    success: boolean;
    userId?: string;
  },
) {
  await prisma.loginAttempt.create({
    data: {
      emailOrKey: payload.emailOrKey,
      ipAddress: payload.ipAddress,
      success: payload.success,
      userId: payload.userId ?? null,
    },
  });
}

export async function clearLoginAttempts(
  prisma: PrismaClient,
  emailOrKey: string,
  ipAddress: string,
) {
  await prisma.loginAttempt.deleteMany({
    where: {
      emailOrKey,
      ipAddress,
    },
  });
}
