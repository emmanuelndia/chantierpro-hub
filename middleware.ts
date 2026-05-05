import { NextResponse, type NextRequest } from 'next/server';
import { WEB_ROUTE_ROLE_MAP } from '@/lib/auth/constants';
import { verifyRefreshToken } from '@/lib/auth/tokens';

function isPublicPath(pathname: string) {
  return (
    pathname === '/web/login' ||
    pathname === '/login' ||
    pathname === '/403' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/refresh') ||
    pathname.startsWith('/api/health') ||
    pathname === '/favicon.ico'
  );
}

function getRequiredRoles(pathname: string) {
  return Object.entries(WEB_ROUTE_ROLE_MAP)
    .sort((left, right) => right[0].length - left[0].length)
    .find(([routePrefix]) => pathname.startsWith(routePrefix))?.[1];
}

function buildLoginUrl(req: NextRequest) {
  const loginUrl = new URL('/web/login', req.url);
  const requestedPath = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  loginUrl.searchParams.set('next', requestedPath);
  return loginUrl;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    (!pathname.startsWith('/web') &&
      !pathname.startsWith('/admin') &&
      !pathname.startsWith('/settings') &&
      pathname !== '/dashboard' &&
      !pathname.startsWith('/dashboard/') &&
      !pathname.startsWith('/reports/') &&
      !pathname.startsWith('/presences/')) ||
    isPublicPath(pathname)
  ) {
    return NextResponse.next();
  }

  const refreshCookie = req.cookies.get('chantierpro_refresh')?.value;

  if (!refreshCookie) {
    return NextResponse.redirect(buildLoginUrl(req));
  }

  try {
    const payload = await verifyRefreshToken(refreshCookie);
    const requiredRoles = getRequiredRoles(pathname);

    if (requiredRoles && !requiredRoles.includes(payload.role as never)) {
      return NextResponse.redirect(new URL('/403', req.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(buildLoginUrl(req));
  }
}

export const config = {
  matcher: [
    '/web/:path*',
    '/admin/:path*',
    '/settings/:path*',
    '/dashboard/:path*',
    '/dashboard',
    '/reports/:path*',
    '/presences/:path*',
  ],
};
