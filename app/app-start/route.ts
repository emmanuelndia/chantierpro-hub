import { headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

const mobileUserAgentPattern = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export async function GET(request: NextRequest) {
  const userAgent = (await headers()).get('user-agent') ?? '';
  const target = mobileUserAgentPattern.test(userAgent) ? '/mobile/home' : '/web/dashboard';

  return NextResponse.redirect(new URL(target, request.url));
}
