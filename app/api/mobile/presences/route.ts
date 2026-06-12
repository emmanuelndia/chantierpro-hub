import type { RhSitePresenceLiveResource, RhSitePresenceLiveStatus } from '@/types/rh';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessSitePresencesLive, getSitePresencesLive, jsonRhError, parseSitePresenceLiveQuery } from '@/lib/rh';

const statusMap = {
  present: 'PRESENT',
  paused: 'PAUSED',
  left: 'LEFT',
  absent: 'EXPECTED_NOT_CLOCKED',
  anomaly: 'ANOMALY',
} as const;

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessSitePresencesLive(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse aux presences mobiles.');
  }

  const searchParams = new URL(req.url).searchParams;
  const rawStatus = searchParams.get('status');
  const mappedStatus = rawStatus && rawStatus in statusMap ? statusMap[rawStatus as keyof typeof statusMap] : null;
  if (mappedStatus) searchParams.set('status', mappedStatus);
  if (rawStatus === 'late') searchParams.set('lateOnly', 'true');

  const data = await getSitePresencesLive(prisma, parseSitePresenceLiveQuery(searchParams), user);
  const resources = aggregateResources(data.sites.flatMap((site) =>
    site.resources.map((resource) => ({ siteName: site.siteName, projectName: site.projectName, resource })),
  ));

  return Response.json({
    generatedAt: data.generatedAt,
    date: data.date,
    summary: {
      total: resources.length,
      present: resources.filter((resource) => resource.status === 'PRESENT' || resource.status === 'PAUSED').length,
      office: resources.filter((resource) => resource.presenceContext === 'OFFICE').length,
      terrain: resources.filter((resource) => resource.presenceContext === 'TERRAIN').length,
      absent: resources.filter((resource) => resource.status === 'ABSENT').length,
      late: resources.filter((resource) => resource.isLate).length,
      anomalies: resources.filter((resource) => resource.status === 'ANOMALY').length,
    },
    options: data.options,
    resources,
  });
});

function aggregateResources(
  rows: { siteName: string; projectName: string; resource: RhSitePresenceLiveResource }[],
) {
  const byUser = new Map<string, { siteName: string; projectName: string; resource: RhSitePresenceLiveResource }[]>();
  for (const row of rows) {
    byUser.set(row.resource.userId, [...(byUser.get(row.resource.userId) ?? []), row]);
  }

  return [...byUser.entries()].map(([userId, contexts]) => {
    const resources = contexts.map((context) => context.resource);
    const status = getAggregateStatus(resources);
    const hasOffice = resources.some((resource) => resource.presenceContext === 'OFFICE');
    const hasTerrain = resources.some((resource) => resource.presenceContext === 'TERRAIN');
    const presenceContext = hasTerrain ? 'TERRAIN' : 'OFFICE';
    const arrivalAt = firstDate(resources.map((resource) => resource.arrivalAt));
    const departureAt = lastDate(resources.map((resource) => resource.departureGps?.recordedAt ?? null));
    const durationSeconds = arrivalAt && departureAt
      ? Math.max(0, Math.floor((new Date(departureAt).getTime() - new Date(arrivalAt).getTime()) / 1000))
      : null;

    return {
      userId,
      name: resources[0]?.name ?? '',
      role: resources[0]?.role ?? '',
      presenceContext,
      contextLabel: hasOffice && hasTerrain ? 'Mixte' : presenceContext === 'OFFICE' ? 'Bureau' : 'Terrain',
      status: status === 'EXPECTED_NOT_CLOCKED' ? 'ABSENT' : status,
      arrivalAt,
      departureAt,
      durationSeconds,
      isLate: resources.some((resource) => resource.isLate),
      positionLabel: buildPositionLabel(contexts),
      detailsCount: contexts.length,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function getAggregateStatus(resources: RhSitePresenceLiveResource[]): Exclude<RhSitePresenceLiveStatus, 'EXPECTED_NOT_CLOCKED'> | 'EXPECTED_NOT_CLOCKED' {
  if (resources.some((resource) => resource.status === 'ANOMALY')) return 'ANOMALY';
  if (resources.some((resource) => resource.status === 'PAUSED')) return 'PAUSED';
  if (resources.some((resource) => resource.status === 'PRESENT')) return 'PRESENT';
  if (resources.some((resource) => resource.status === 'EXPECTED_NOT_CLOCKED')) return 'EXPECTED_NOT_CLOCKED';
  return 'LEFT';
}

function firstDate(values: (string | null)[]) {
  return values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
}

function lastDate(values: (string | null)[]) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function buildPositionLabel(contexts: { siteName: string; projectName: string; resource: RhSitePresenceLiveResource }[]) {
  const hasOffice = contexts.some((context) => context.resource.presenceContext === 'OFFICE');
  const terrainContexts = contexts.filter((context) => context.resource.presenceContext === 'TERRAIN');
  if (hasOffice && terrainContexts.length > 0) return 'Mixte - Bureau + Terrain';
  if (hasOffice) return `Bureau - ${contexts[0]?.siteName ?? 'Bureau'}`;
  const uniqueSites = new Set(terrainContexts.map((context) => context.siteName));
  if (uniqueSites.size > 1) return 'Terrain - Multi-chantiers';
  return `Terrain - ${terrainContexts[0]?.siteName ?? 'Terrain'}`;
}
