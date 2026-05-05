import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';

type PushTokenRequestBody = {
  token?: string;
  platform?: string;
  deviceLabel?: string;
};

export const POST = withAuth(async ({ req, user }) => {
  let body: PushTokenRequestBody = {};

  try {
    body = JSON.parse(await req.text()) as PushTokenRequestBody;
  } catch {
    body = {};
  }

  const token = body.token?.trim() ?? '';
  const platform = body.platform?.trim() ?? '';

  if (!token || !platform) {
    return NextResponse.json({ code: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  await prisma.pushToken.upsert({
    where: { token },
    update: {
      userId: user.id,
      platform,
      deviceLabel: body.deviceLabel?.trim() ?? null,
      lastSeenAt: new Date(),
    },
    create: {
      userId: user.id,
      token,
      platform,
      deviceLabel: body.deviceLabel?.trim() ?? null,
      lastSeenAt: new Date(),
    },
  });

  return new NextResponse(null, { status: 204 });
});
