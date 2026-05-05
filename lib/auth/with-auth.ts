import { NextResponse, type NextRequest } from 'next/server';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authUserSelect, serializeAuthUser } from '@/lib/auth/serializers';
import { verifyAccessToken } from '@/lib/auth/tokens';

type RouteParams = Record<string, string | string[]>;

type WithAuthContext<TParams extends RouteParams> = {
  req: NextRequest;
  user: ReturnType<typeof serializeAuthUser>;
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
    const authorization = req.headers.get('authorization');

    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const token = authorization.slice('Bearer '.length);

    try {
      const payload = await verifyAccessToken(token);
      const params = await context.params;
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: authUserSelect,
      });

      if (!user?.isActive) {
        return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
      }

      if (roles.length > 0 && !roles.includes(user.role)) {
        return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
      }

      return handler({
        req,
        user: serializeAuthUser(user),
        params,
      });
    } catch {
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }
  };
}
