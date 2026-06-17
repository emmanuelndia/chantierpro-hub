import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canMutateWebPlanning } from '@/lib/mobile-planning';
import { commitPlanningImport, parsePlanningImportRowsPayload } from '@/lib/planning-import';

export const POST = withAuth(async ({ req, user }) => {
  if (!canMutateWebPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Import planning refusé.' }, { status: 403 });
  }

  const rows = parsePlanningImportRowsPayload(await req.json().catch(() => null));
  if (!rows) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Lignes planning invalides.' }, { status: 400 });
  }

  try {
    const result = await commitPlanningImport(prisma, { user, rows });
    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error('Planning import commit error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: "Erreur lors de l'import du planning." },
      { status: 500 },
    );
  }
});
