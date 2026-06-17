import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canMutateWebPlanning } from '@/lib/mobile-planning';
import { previewPlanningImport } from '@/lib/planning-import';

export const POST = withAuth(async ({ req, user }) => {
  if (!canMutateWebPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Import planning refusé.' }, { status: 403 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');
  if (!(file instanceof File)) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Fichier planning manquant.' }, { status: 400 });
  }

  try {
    const preview = await previewPlanningImport(prisma, { file, user });
    return Response.json(preview);
  } catch (error) {
    return Response.json(
      { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Prévisualisation impossible.' },
      { status: 400 },
    );
  }
});
