import { withAuth } from '@/lib/auth/with-auth';
import { canWriteProjects, getScopedProjectById, jsonProjectError } from '@/lib/projects';
import { prisma } from '@/lib/prisma';
import { commitSiteImport, parseSiteImportRowsPayload } from '@/lib/site-import';

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a l import de chantiers.');
  }

  const project = await getScopedProjectById(prisma, params.id, user);
  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  if (project.status === 'ARCHIVED' || project.status === 'COMPLETED') {
    return jsonProjectError('PROJECT_CLOSED', 409, 'Impossible d importer des chantiers dans un projet clos.');
  }

  const rows = parseSiteImportRowsPayload(await req.json().catch(() => null));
  if (!rows) {
    return jsonProjectError('BAD_REQUEST', 400, 'Payload import invalide.');
  }

  try {
    const result = await commitSiteImport(prisma, {
      projectId: project.id,
      user,
      rows,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error('Site import commit failed', error);
    return jsonProjectError('BAD_REQUEST', 400, "Impossible de creer les chantiers importes.");
  }
});
