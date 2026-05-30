import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getCoordinatorScopedSiteIds } from '@/lib/reports';
import { createInternalPhotoUrl } from '@/lib/photos';
import type { ReportDetail } from '@/types/mobile-reports';

export const GET = withAuth<{ id: string }>(async ({ user, params }) => {
  if (user.role !== Role.COORDINATOR) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const siteIds = await getCoordinatorScopedSiteIds(prisma, user.id);

    if (siteIds.length === 0) {
      return Response.json({ code: 'NOT_FOUND', message: 'Rapport non trouvé' }, { status: 404 });
    }

    const report = await prisma.report.findFirst({
      where: {
        id: params.id,
        siteId: { in: siteIds },
        user: {
          role: { in: [Role.SUPERVISOR, Role.RESOURCE] },
        },
      },
      select: {
        id: true,
        userId: true,
        siteId: true,
        content: true,
        progression: true,
        status: true,
        submittedAt: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        site: {
          select: {
            name: true,
            address: true,
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
      return Response.json({ code: 'NOT_FOUND', message: 'Rapport non trouvé' }, { status: 404 });
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
        tags: true,
        description: true,
        planningAssignmentId: true,
        planningAssignment: {
          select: {
            action: true,
          },
        },
      },
    });

    const sessionDuration = Math.max(
      0,
      Math.floor(
        (report.submittedAt.getTime() - report.clockInRecord.timestampLocal.getTime()) / 1000,
      ),
    );

    const reportDetail: ReportDetail = {
      id: report.id,
      supervisorId: report.userId,
      supervisorName: report.user.lastName,
      supervisorFirstName: report.user.firstName,
      siteId: report.siteId,
      siteName: report.site.name,
      siteAddress: report.site.address,
      sessionStartedAt: report.clockInRecord.timestampLocal.toISOString(),
      sessionEndedAt: report.submittedAt.toISOString(),
      sessionDuration,
      progressPercentage: report.progression ?? 100,
      submittedAt: report.submittedAt.toISOString(),
      content: report.content,
      status: report.status,
      photos: photos.map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        url: createInternalPhotoUrl(photo.id),
        takenAt: photo.takenAt.toISOString(),
        tags: photo.tags,
        planningAssignmentId: photo.planningAssignmentId,
        ...(photo.planningAssignment ? { assignmentAction: photo.planningAssignment.action } : {}),
        description: photo.description ?? undefined,
      })),
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
