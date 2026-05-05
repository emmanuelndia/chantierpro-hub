import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient, Role } from '@prisma/client';
import { ACCESS_TOKEN_EXPIRES_IN_SECONDS } from '@/lib/auth/constants';
import { serializeAuthUser } from '@/lib/auth/serializers';
import { signAccessToken, signRefreshToken } from '@/lib/auth/tokens';

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSessionTokens(
  prisma: PrismaClient,
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    isActive: boolean;
    mustChangePassword: boolean;
  },
  metadata: {
    ipAddress: string;
    userAgent?: string | null;
  },
) {
  const tokenId = randomUUID();
  const accessToken = await signAccessToken(user);
  const refreshToken = await signRefreshToken(user, tokenId);

  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent ?? null,
    },
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    user: serializeAuthUser(user),
  };
}
