import { headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

const mobileUserAgentPattern = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export async function GET(request: NextRequest) {
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get('user-agent') ?? '';
  const mobileClientHint = requestHeaders.get('sec-ch-ua-mobile');
  const isMobile =
    mobileClientHint === '?1' ||
    (mobileClientHint !== '?0' && mobileUserAgentPattern.test(userAgent));
  const target = isMobile ? '/mobile/home' : '/web/dashboard';

  return NextResponse.redirect(new URL(target, request.url));
}
