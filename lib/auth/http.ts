import { NextResponse } from 'next/server';
import type { AuthErrorCode } from '@/types/auth';

export function jsonError(
  code: AuthErrorCode,
  status: number,
  extra?: Record<string, number | string | boolean>,
) {
  return NextResponse.json(
    {
      code,
      ...extra,
    },
    { status },
  );
}

export function getClientIp(headers: Headers) {
  const forwardedFor = headers.get('x-forwarded-for');

  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() ?? 'unknown';
  }

  return headers.get('x-real-ip') ?? 'unknown';
}
