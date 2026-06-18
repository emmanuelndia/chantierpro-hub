import { NextResponse } from 'next/server';
import { SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canWriteSites,
  getScopedProjectById,
  jsonProjectError,
  parseJsonBody,
  projectDetailSelect,
  serializeProjectDetail,
} from '@/lib/projects';

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canWriteSites(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a la cloture des sites.');
  }

  const project = await getScopedProjectById(prisma, params.id, user);
  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const siteIds = parseSiteIds(body);
  if (siteIds.length === 0) {
    return jsonProjectError('BAD_REQUEST', 400, 'Selectionne au moins un site a terminer.');
  }

  const eligibleSites = await prisma.site.findMany({
    where: {
      id: { in: siteIds },
      projectId: params.id,
      status: { not: SiteStatus.COMPLETED },
    },
    select: { id: true },
  });

  if (eligibleSites.length === 0) {
    return jsonProjectError('BAD_REQUEST', 400, 'Aucun site selectionne ne peut etre termine.');
  }

  await prisma.site.updateMany({
    where: {
      id: { in: eligibleSites.map((site) => site.id) },
      projectId: params.id,
    },
    data: {
      status: SiteStatus.COMPLETED,
      endDate: new Date(),
    },
  });

  const updatedProject = await prisma.project.findUniqueOrThrow({
    where: { id: params.id },
    select: projectDetailSelect,
  });

  return NextResponse.json({
    updatedCount: eligibleSites.length,
    project: serializeProjectDetail(updatedProject),
  });
});

function parseSiteIds(body: unknown) {
  if (!body || typeof body !== 'object') return [];
  const rawSiteIds = (body as { siteIds?: unknown }).siteIds;
  if (!Array.isArray(rawSiteIds)) return [];
  return [...new Set(rawSiteIds.filter((siteId): siteId is string => typeof siteId === 'string' && siteId.trim().length > 0))];
}
