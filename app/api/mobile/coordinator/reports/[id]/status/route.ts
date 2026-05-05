import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import type { ReportStatus } from '@/types/mobile-reports';

export const PATCH = withAuth(async ({ user, params, body }) => {
  if (user.role !== 'COORDINATOR') {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = params;
  const { status, coordinatorComment } = body as {
    status: ReportStatus;
    coordinatorComment?: string;
  };

  if (!status) {
    return Response.json(
      { code: 'INVALID_REQUEST', message: 'Statut manquant' },
      { status: 400 }
    );
  }

  // Valider les transitions de statut
  const validTransitions: Record<ReportStatus, ReportStatus[]> = {
    PENDING: ['SUBMITTED'],
    SUBMITTED: ['REVIEWED', 'VALIDATED'],
    REVIEWED: ['VALIDATED'],
    VALIDATED: ['SENT'],
    SENT: [], // Statut final
  };

  try {
    // Récupérer le rapport actuel
    const currentReport = await prisma.report.findFirst({
      where: {
        id,
        author: {
          role: 'SUPERVISOR',
        },
        site: {
          coordinatorId: user.id,
        },
      },
    });

    if (!currentReport) {
      return Response.json(
        { code: 'NOT_FOUND', message: 'Rapport non trouvé' },
        { status: 404 }
      );
    }

    // Vérifier que la transition est valide
    const allowedStatuses = validTransitions[currentReport.status as ReportStatus] || [];
    if (!allowedStatuses.includes(status)) {
      return Response.json(
        { 
          code: 'INVALID_TRANSITION', 
          message: `Transition de statut invalide: ${currentReport.status} → ${status}` 
        },
        { status: 400 }
      );
    }

    // Mettre à jour le rapport
    const updatedReport = await prisma.report.update({
      where: { id },
      data: {
        status,
        coordinatorComment: coordinatorComment || null,
        updatedAt: new Date(),
      },
      include: {
        author: true,
        site: true,
      },
    });

    // Créer une notification pour le superviseur si le statut change
    if (status !== currentReport.status) {
      await prisma.notification.create({
        data: {
          userId: updatedReport.authorId,
          title: 'Statut du rapport mis à jour',
          message: `Votre rapport pour ${updatedReport.site.name} est maintenant: ${getStatusLabel(status)}`,
          type: 'REPORT_STATUS_UPDATE',
          createdAt: new Date(),
          readAt: null,
        },
      });
    }

    // Journaliser l'action
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'UPDATE_REPORT_STATUS',
        targetType: 'REPORT',
        targetId: id,
        details: {
          coordinatorName: `${user.firstName} ${user.lastName}`,
          previousStatus: currentReport.status,
          newStatus: status,
          supervisorName: `${updatedReport.author.firstName} ${updatedReport.author.lastName}`,
          siteName: updatedReport.site.name,
        },
        createdAt: new Date(),
      },
    });

    return Response.json({
      success: true,
      report: {
        id: updatedReport.id,
        status: updatedReport.status,
        coordinatorComment: updatedReport.coordinatorComment,
        updatedAt: updatedReport.updatedAt,
      },
    });

  } catch (error) {
    console.error('Update report status error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors de la mise à jour du statut' },
      { status: 500 }
    );
  }
});

function getStatusLabel(status: ReportStatus): string {
  const labels = {
    PENDING: 'En attente',
    SUBMITTED: 'Soumis',
    REVIEWED: 'Révisé',
    VALIDATED: 'Validé',
    SENT: 'Envoyé',
  };
  return labels[status] || status;
}
