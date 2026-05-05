import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import {
  ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  REFRESH_TOKEN_EXPIRES_IN_SECONDS,
} from '@/lib/auth/constants';

type TokenType = 'access' | 'refresh';

type BaseTokenPayload = JWTPayload & {
  sub: string;
  role: string;
  type: TokenType;
};

export type AccessTokenPayload = BaseTokenPayload & {
  type: 'access';
};

export type RefreshTokenPayload = BaseTokenPayload & {
  type: 'refresh';
  tokenId: string;
};

function getSecret(value: string) {
  return new TextEncoder().encode(value);
}

function getRequiredEnv(name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET') {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function signAccessToken(user: { id: string; role: string }) {
  return new SignJWT({
    role: user.role,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_EXPIRES_IN_SECONDS}s`)
    .sign(getSecret(getRequiredEnv('JWT_SECRET')));
}

export async function signRefreshToken(user: { id: string; role: string }, tokenId: string) {
  return new SignJWT({
    role: user.role,
    type: 'refresh',
    tokenId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_EXPIRES_IN_SECONDS}s`)
    .sign(getSecret(getRequiredEnv('JWT_REFRESH_SECRET')));
}

export async function verifyAccessToken(token: string) {
  const result = await jwtVerify(token, getSecret(getRequiredEnv('JWT_SECRET')));
  const payload = result.payload as AccessTokenPayload;

  if (payload.type !== 'access') {
    throw new Error('Invalid access token type');
  }

  return payload;
}

export async function verifyRefreshToken(token: string) {
  const result = await jwtVerify(token, getSecret(getRequiredEnv('JWT_REFRESH_SECRET')));
  const payload = result.payload as RefreshTokenPayload;

  if (payload.type !== 'refresh' || !payload.tokenId) {
    throw new Error('Invalid refresh token type');
  }

  return payload;
}
