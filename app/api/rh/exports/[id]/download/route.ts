import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessRh, getRhExportDownloadArtifact, jsonRhError } from '@/lib/rh';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, "Acces refuse au telechargement RH.");
  }

  const artifact = await getRhExportDownloadArtifact(prisma, params.id);

  if (!artifact) {
    return jsonRhError('NOT_FOUND', 404, 'Export introuvable.');
  }

  if (artifact.state === 'expired') {
    return jsonRhError('EXPORT_EXPIRED', 410, "Cet export n'est plus disponible.");
  }

  return NextResponse.redirect(artifact.signedUrl);
});
