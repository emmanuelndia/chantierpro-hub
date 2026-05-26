import { canWriteProjects, getScopedProjectById, jsonProjectError } from '@/lib/projects';
import { buildSiteImportTemplate } from '@/lib/site-import';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse au modele d import chantiers.');
  }

  const project = await getScopedProjectById(prisma, params.id, user);
  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  const buffer = await buildSiteImportTemplate();
  const fileName = `modele-import-chantiers-${project.name.replace(/[^\w.-]+/g, '_')}.xlsx`;

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
});
