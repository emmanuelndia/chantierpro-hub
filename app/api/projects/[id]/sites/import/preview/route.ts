import { withAuth } from '@/lib/auth/with-auth';
import { canWriteSites, getScopedProjectById, jsonProjectError } from '@/lib/projects';
import { prisma } from '@/lib/prisma';
import { parseSiteImportFile, previewSiteImport } from '@/lib/site-import';

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canWriteSites(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a l import de chantiers.');
  }

  const project = await getScopedProjectById(prisma, params.id, user);
  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  if (project.status === 'ARCHIVED' || project.status === 'COMPLETED') {
    return jsonProjectError('PROJECT_CLOSED', 409, 'Impossible d importer des chantiers dans un projet clos.');
  }

  const formData = await req.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return jsonProjectError('BAD_REQUEST', 400, 'Fichier import manquant.');
  }

  try {
    const rows = await parseSiteImportFile(file);
    const preview = await previewSiteImport(prisma, {
      projectId: project.id,
      user,
      rows,
    });
    return Response.json(preview);
  } catch (error) {
    if (error instanceof Error && error.message === 'FORMAT_UNSUPPORTED') {
      return jsonProjectError('BAD_REQUEST', 400, 'Format non supporte. Utilisez un fichier .xlsx ou .csv.');
    }

    console.error('Site import preview failed', error);
    return jsonProjectError('BAD_REQUEST', 400, "Impossible d analyser ce fichier.");
  }
});
