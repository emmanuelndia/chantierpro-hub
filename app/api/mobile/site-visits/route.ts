import { Prisma, ProjectStatus, Role, SiteStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { prisma } from '@/lib/prisma';
import { jsonProjectError } from '@/lib/projects';

export const POST = withAuth(async ({ req, user }) => {
  if (user.role !== Role.AUDITOR) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces reserve aux auditeurs.');
  }

  const body = await parseJsonBody(req);
  const siteId = getText(body, 'siteId');

  if (!siteId) {
    return jsonProjectError('BAD_REQUEST', 400, 'Chantier requis pour enregistrer la visite.');
  }

  const site = await prisma.site.findFirst({
    where: {
      id: siteId,
      status: SiteStatus.ACTIVE,
      project: { status: ProjectStatus.IN_PROGRESS },
    },
    select: { id: true, projectId: true },
  });

  if (!site) {
    return jsonProjectError('NOT_FOUND', 404, 'Chantier introuvable ou inactif.');
  }

  const latitude = getNumber(body, 'latitude');
  const longitude = getNumber(body, 'longitude');
  const accuracy = getNumber(body, 'accuracy');
  const comment = getText(body, 'comment');

  const visit = await prisma.siteVisitLog.create({
    data: {
      auditorId: user.id,
      projectId: site.projectId,
      siteId: site.id,
      comment,
      latitude: latitude === null ? null : new Prisma.Decimal(latitude),
      longitude: longitude === null ? null : new Prisma.Decimal(longitude),
      accuracy: accuracy === null ? null : new Prisma.Decimal(accuracy),
    },
    select: { id: true, visitedAt: true },
  });

  return Response.json({ visit: { id: visit.id, visitedAt: visit.visitedAt.toISOString() } }, { status: 201 });
});

async function parseJsonBody(req: Request) {
  try {
    return (await req.json()) as unknown;
  } catch {
    return null;
  }
}

function getText(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : null;
}

function getNumber(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
