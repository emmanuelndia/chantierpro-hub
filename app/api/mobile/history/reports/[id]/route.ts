import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createInternalPhotoUrl } from '@/lib/photos';
import type { ReportDetail } from '@/types/mobile-history-reports';

const allowedRoles: readonly Role[] = [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR, Role.BE_RESOURCE];

export const GET = withAuth<{ id: string }>(async ({ user, params }) => {
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const report = await prisma.report.findFirst({
      where: {
        id: params.id,
        userId: user.id,
      },
      select: {
        id: true,
        siteId: true,
        userId: true,
        content: true,
        progression: true,
        blocage: true,
        status: true,
        submittedAt: true,
        createdAt: true,
        site: {
          select: {
            id: true,
            name: true,
          },
        },
        clockInRecord: {
          select: {
            clockInDate: true,
            timestampLocal: true,
          },
        },
      },
    });

    if (!report) {
      return Response.json(
        { code: 'REPORT_NOT_FOUND', message: 'Rapport non trouvé' },
        { status: 404 },
      );
    }

    const dayStart = new Date(report.clockInRecord.clockInDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const photos = await prisma.photo.findMany({
      where: {
        siteId: report.siteId,
        uploadedById: report.userId,
        isDeleted: false,
        timestampLocal: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      orderBy: [{ takenAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        filename: true,
        takenAt: true,
        description: true,
      },
    });

    const durationSeconds = Math.max(
      0,
      Math.floor(
        (report.submittedAt.getTime() - report.clockInRecord.timestampLocal.getTime()) / 1000,
      ),
    );

    const reportDetail: ReportDetail = {
      id: report.id,
      siteId: report.site.id,
      siteName: report.site.name,
      date: report.createdAt.toISOString().split('T')[0] ?? report.createdAt.toISOString(),
      progressPercentage: report.progression ?? 0,
      content: report.content,
      status: report.status,
      photoCount: photos.length,
      ...(report.blocage ? { blockageNote: report.blocage } : {}),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.submittedAt.toISOString(),
      photos: photos.map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        url: createInternalPhotoUrl(photo.id),
        thumbnail: createInternalPhotoUrl(photo.id),
        takenAt: photo.takenAt.toISOString(),
        ...(photo.description ? { description: photo.description } : {}),
      })),
      sessionInfo: {
        arrivalAt: report.clockInRecord.timestampLocal.toISOString(),
        departureAt: report.submittedAt.toISOString(),
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
