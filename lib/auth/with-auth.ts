import { NextResponse, type NextRequest } from 'next/server';
import type { Role } from '@prisma/client';
import { getAuthResultFromRequest, type RequestAuthUser } from '@/lib/auth/request-user';

type RouteParams = Record<string, string | string[]>;

type WithAuthContext<TParams extends RouteParams> = {
  req: NextRequest;
  user: RequestAuthUser;
  params: TParams;
};

type WithAuthHandler<TParams extends RouteParams> = (
  context: WithAuthContext<TParams>,
) => Promise<Response> | Response;

export function withAuth<TParams extends RouteParams = RouteParams>(
  handler: WithAuthHandler<TParams>,
  roles: Role[] = [],
) {
  return async (
    req: NextRequest,
    context: {
      params: Promise<TParams>;
    },
  ) => {
    const auth = await getAuthResultFromRequest(req, roles);

    if (!auth.ok) {
      if (auth.code === 'ROLE_FORBIDDEN') {
        console.warn('Auth rejected:', {
          path: req.nextUrl.pathname,
          reason: 'ROLE_FORBIDDEN',
        });
        return NextResponse.json({ code: 'FORBIDDEN', reason: auth.code }, { status: 403 });
      }

      console.warn('Auth rejected:', {
        path: req.nextUrl.pathname,
        reason: auth.code,
      });
      return NextResponse.json({ code: 'UNAUTHORIZED', reason: auth.code }, { status: 401 });
    }

    const params = await context.params;

    return handler({
      req,
      user: auth.user,
      params,
    });
  };
}
