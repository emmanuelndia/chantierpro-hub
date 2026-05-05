import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createInternalPhotoUrl } from '@/lib/photos';
import type { ReportDetail } from '@/types/mobile-reports';

export const GET = withAuth(async ({ user, params }) => {
  if (user.role !== 'COORDINATOR') {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = params;

  try {
    // Vérifier que le coordinateur a accès à ce rapport
    const report = await prisma.report.findFirst({
      where: {
        id,
        author: {
          role: 'SUPERVISOR',
        },
        site: {
          coordinatorId: user.id,
        },
      },
      include: {
        author: true,
        site: true,
        photos: {
          orderBy: {
            takenAt: 'asc',
          },
        },
      },
    });

    if (!report) {
      return Response.json(
        { code: 'NOT_FOUND', message: 'Rapport non trouvé' },
        { status: 404 }
      );
    }

    // Récupérer la session correspondante
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const session = await prisma.clockInSession.findFirst({
      where: {
        userId: report.authorId,
        siteId: report.siteId,
        date: {
          gte: today,
          lt: tomorrow,
        },
        departureAt: {
          not: null,
        },
      },
    });

    const sessionDuration = session ? 
      Math.floor((new Date(session.departureAt!).getTime() - new Date(session.arrivalAt).getTime()) / 1000) 
      : 0;

    const reportDetail: ReportDetail = {
      id: report.id,
      supervisorId: report.authorId,
      supervisorName: report.author.lastName,
      supervisorFirstName: report.author.firstName,
      siteId: report.siteId,
      siteName: report.site.name,
      siteAddress: report.site.address,
      sessionStartedAt: session?.arrivalAt.toISOString() || report.createdAt.toISOString(),
      sessionEndedAt: session?.departureAt?.toISOString() || report.updatedAt.toISOString(),
      sessionDuration,
      progressPercentage: 100, // Rapport soumis = 100%
      submittedAt: report.createdAt.toISOString(),
      content: report.content || '',
      status: report.status as any,
      photos: report.photos.map(photo => ({
        id: photo.id,
        filename: photo.filename,
        url: createInternalPhotoUrl(photo.id),
        takenAt: photo.takenAt.toISOString(),
        description: photo.description,
      })),
      coordinatorComment: report.coordinatorComment || undefined,
    };

    return Response.json(reportDetail);
  } catch (error) {
    console.error('Report detail error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du rapport' },
      { status: 500 }
    );
  }
});
