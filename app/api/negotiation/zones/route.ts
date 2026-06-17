import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessNegotiation, canManageNegotiation, listNegotiationZones, negotiationProjectWhere, normalizeNegotiationZoneName, serializeNegotiationZone } from '@/lib/negotiation';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces zones negociation refuse.' }, { status: 403 });
  }

  const projectId = new URL(req.url).searchParams.get('projectId') ?? undefined;
  const zones = await listNegotiationZones(prisma, user, projectId);

  return Response.json({ zones });
});

export const POST = withAuth(async ({ req, user }) => {
  if (!canManageNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Creation zone negociation refusee.' }, { status: 403 });
  }

  const body = (await req.json().catch((): unknown => null)) as unknown;
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const projectId = text(data.projectId);
  const name = text(data.name);
  const city = nullableText(data.city);
  const region = nullableText(data.region);

  if (!projectId || !name) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Projet et nom de zone obligatoires.' }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, ...negotiationProjectWhere(user) },
    select: { id: true },
  });

  if (!project) {
    return Response.json({ code: 'PROJECT_NOT_FOUND', message: 'Projet introuvable ou inactif.' }, { status: 404 });
  }

  const normalizedName = normalizeNegotiationZoneName(name);

  const zone = await prisma.negotiationZone.upsert({
    where: {
      projectId_normalizedName: {
        projectId,
        normalizedName,
      },
    },
    update: {
      name,
      city,
      region,
    },
    create: {
      projectId,
      name,
      normalizedName,
      city,
      region,
    },
  });

  return Response.json({ zone: serializeNegotiationZone(zone) }, { status: 201 });
});

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}
