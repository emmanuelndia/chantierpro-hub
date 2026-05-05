import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';
import { REFRESH_COOKIE_NAME, REFRESH_TOKEN_EXPIRES_IN_SECONDS } from '@/lib/auth/constants';

function shouldUseSecureCookie() {
  if (process.env.AUTH_COOKIE_SECURE === 'false') {
    return false;
  }

  if (process.env.AUTH_COOKIE_SECURE === 'true') {
    return true;
  }

  return process.env.NODE_ENV === 'production';
}

function buildRefreshCookieBase() {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'strict' as const,
    path: '/',
  };
}

export function createRefreshCookie(token: string): ResponseCookie {
  return {
    name: REFRESH_COOKIE_NAME,
    value: token,
    maxAge: REFRESH_TOKEN_EXPIRES_IN_SECONDS,
    ...buildRefreshCookieBase(),
  };
}

export function createExpiredRefreshCookie(): ResponseCookie {
  return {
    name: REFRESH_COOKIE_NAME,
    value: '',
    maxAge: 0,
    expires: new Date(0),
    ...buildRefreshCookieBase(),
  };
}
