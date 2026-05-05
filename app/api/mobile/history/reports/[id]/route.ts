import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createInternalPhotoUrl } from '@/lib/photos';
import type { ReportDetail } from '@/types/mobile-history-reports';

export const GET = withAuth(async ({ user, params }) => {
  const allowedRoles = ['SUPERVISOR', 'COORDINATOR', 'GENERAL_SUPERVISOR'];

  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = params;

  try {
    const report = await prisma.report.findFirst({
      where: {
        id: id as string,
        authorId: user.id,
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
        photos: {
          select: {
            id: true,
            filename: true,
            takenAt: true,
            description: true,
          },
          orderBy: {
            takenAt: 'asc',
          },
        },
        clockInRecord: {
          select: {
            arrivalAt: true,
            departureAt: true,
          },
        },
      },
    });

    if (!report) {
      return Response.json(
        { code: 'REPORT_NOT_FOUND', message: 'Rapport non trouve' },
        { status: 404 },
      );
    }

    let durationSeconds = 0;
    if (report.clockInRecord?.arrivalAt && report.clockInRecord?.departureAt) {
      durationSeconds = Math.floor(
        (new Date(report.clockInRecord.departureAt).getTime() - new Date(report.clockInRecord.arrivalAt).getTime()) / 1000,
      );
    }

    const reportDetail: ReportDetail = {
      id: report.id,
      siteId: report.site.id,
      siteName: report.site.name,
      date: report.createdAt.toISOString().split('T')[0],
      progressPercentage: report.progressPercentage || 0,
      content: report.content || '',
      status: report.status as any,
      photoCount: report.photos.length,
      coordinatorComment: undefined,
      blockageNote: report.blockageNote || undefined,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      photos: report.photos.map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        url: createInternalPhotoUrl(photo.id),
        thumbnail: createInternalPhotoUrl(photo.id),
        takenAt: photo.takenAt.toISOString(),
        description: photo.description,
      })),
      sessionInfo: {
        arrivalAt: report.clockInRecord?.arrivalAt?.toISOString() || report.createdAt.toISOString(),
        departureAt: report.clockInRecord?.departureAt?.toISOString() || report.updatedAt.toISOString(),
        durationSeconds,
      },
    };

    return Response.json(reportDetail);
  } catch (error) {
    console.error('Report detail error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du rapport' },
      { status: 500 },
    );
  }
});
