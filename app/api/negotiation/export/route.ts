import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessNegotiation, listNegotiationOverview } from '@/lib/negotiation';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const overview = await listNegotiationOverview(prisma, user, date);
  const rows = [
    ['Date', 'Projet', 'Ressource', 'Scope', 'Zone reelle', 'Ville', 'Commune', 'Statut', 'Remarque', 'Latitude', 'Longitude'],
    ...overview.visits.map((visit) => [
      date,
      visit.project?.name ?? '',
      visit.resourceName ?? '',
      visit.buildingName,
      visit.actualZone ?? '',
      visit.city ?? '',
      visit.commune ?? '',
      visit.status,
      visit.remark,
      visit.latitude ?? '',
      visit.longitude ?? '',
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(';')).join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="suivi-negociation-${date}.csv"`,
    },
  });
});

function csvCell(value: string | number) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}
