import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canManageNegotiation, negotiationProjectWhere, searchNegotiationBuildings, serializeNegotiationBuilding } from '@/lib/negotiation';

export const GET = withAuth(async ({ req, user }) => {
  const searchParams = new URL(req.url).searchParams;
  const projectId = searchParams.get('projectId') ?? '';
  const q = searchParams.get('q') ?? '';

  if (!projectId) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Projet obligatoire.' }, { status: 400 });
  }

  return searchNegotiationBuildings(prisma, user, projectId, q);
});

export const POST = withAuth(async ({ req, user }) => {
  if (!canManageNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Creation scope refusee.' }, { status: 403 });
  }

  const body = (await req.json().catch((): unknown => null)) as unknown;
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const projectId = text(data.projectId);
  const name = text(data.name);
  const city = text(data.city) || 'Non renseigne';

  if (!projectId || !name) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Projet et nom du scope obligatoires.' }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, ...negotiationProjectWhere(user) },
    select: { id: true },
  });
  if (!project) {
    return Response.json({ code: 'PROJECT_NOT_FOUND', message: 'Projet introuvable ou inactif.' }, { status: 404 });
  }

  const scope = await prisma.negotiationBuilding.create({
    data: {
      projectId,
      name,
      city,
      commune: nullableText(data.commune),
      plaque: nullableText(data.plaque),
      cluster: nullableText(data.cluster),
      habitation: nullableText(data.habitation),
      contactInfo: nullableText(data.contactInfo),
      longitude: numberOrNull(data.longitude),
      latitude: numberOrNull(data.latitude),
      negotiationStatus: nullableText(data.negotiationStatus),
      remark: nullableText(data.remark),
    },
  });

  return Response.json({ scope: serializeNegotiationBuilding(scope) }, { status: 201 });
});

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}

function numberOrNull(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Number(normalized.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
