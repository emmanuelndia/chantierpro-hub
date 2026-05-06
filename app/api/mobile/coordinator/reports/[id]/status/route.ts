import { ReportStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';

type UpdateReportStatusBody = {
  status?: ReportStatus;
};

const validTransitions: Record<ReportStatus, ReportStatus[]> = {
  RECU: [ReportStatus.EN_REVUE, ReportStatus.VALIDE],
  EN_REVUE: [ReportStatus.VALIDE],
  VALIDE: [ReportStatus.ENVOYE],
  ENVOYE: [],
};

export const PATCH = withAuth<{ id: string }>(async ({ user, params, req }) => {
  if (user.role !== Role.COORDINATOR) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as UpdateReportStatusBody | null;
  const status = body?.status;

  if (!status || !Object.values(ReportStatus).includes(status)) {
    return Response.json({ code: 'INVALID_REQUEST', message: 'Statut invalide' }, { status: 400 });
  }

  try {
    const siteIds = await getOperationalSiteIds(prisma, user.id);
    const currentReport = await prisma.report.findFirst({
      where: {
        id: params.id,
        siteId: { in: siteIds },
        user: {
          role: Role.SUPERVISOR,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!currentReport) {
      return Response.json({ code: 'NOT_FOUND', message: 'Rapport non trouvé' }, { status: 404 });
    }

    if (!validTransitions[currentReport.status].includes(status)) {
      return Response.json(
        {
          code: 'INVALID_TRANSITION',
          message: `Transition de statut invalide: ${currentReport.status} -> ${status}`,
        },
        { status: 400 },
      );
    }

    const updatedReport = await prisma.report.update({
      where: { id: params.id },
      data: { status },
      select: {
        id: true,
        status: true,
        submittedAt: true,
      },
    });

    return Response.json({
      success: true,
      report: {
        id: updatedReport.id,
        status: updatedReport.status,
        updatedAt: updatedReport.submittedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Update report status error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors de la mise à jour du statut' },
      { status: 500 },
    );
  }
});
