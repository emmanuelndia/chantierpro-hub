import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessWebPlanning } from '@/lib/mobile-planning';
import { buildPlanningExportXlsx, parsePlanningExportQuery } from '@/lib/planning-export';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessWebPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: "Accès refusé à l'export planning." }, { status: 403 });
  }

  const query = parsePlanningExportQuery(req.nextUrl.searchParams);
  if (!query) {
    return Response.json({ code: 'INVALID_QUERY', message: 'Paramètres export planning invalides.' }, { status: 400 });
  }

  try {
    const artifact = await buildPlanningExportXlsx(prisma, user, query);
    return new Response(artifact.buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
      },
    });
  } catch (error) {
    console.error('Planning export error:', error);
    return Response.json(
      { code: 'EXPORT_FAILED', message: "La génération du récap planning a échoué." },
      { status: 500 },
    );
  }
});
