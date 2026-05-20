import { ClockInStatus, ClockInType, PlanningWorkLocationType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createInternalPhotoUrl } from '@/lib/photos';
import type { SessionReportData } from '@/types/mobile-session-report';

const allowedRoles: readonly Role[] = [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR];

export const GET = withAuth<{ sessionId: string }>(async ({ user, params }) => {
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const departureRecord = await prisma.clockInRecord.findFirst({
      where: {
        id: params.sessionId,
        userId: user.id,
        status: ClockInStatus.VALID,
        type: ClockInType.DEPARTURE,
      },
      select: {
        id: true,
        userId: true,
        siteId: true,
        clockInDate: true,
        timestampLocal: true,
        site: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    if (!departureRecord) {
      return Response.json(
        { code: 'SESSION_NOT_FOUND', message: 'Session non trouvée ou non terminée' },
        { status: 404 },
      );
    }

    const arrivalRecord = await prisma.clockInRecord.findFirst({
      where: {
        userId: user.id,
        siteId: departureRecord.siteId,
        clockInDate: departureRecord.clockInDate,
        status: ClockInStatus.VALID,
        type: ClockInType.ARRIVAL,
        timestampLocal: {
          lte: departureRecord.timestampLocal,
        },
      },
      orderBy: [{ timestampLocal: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: {
        timestampLocal: true,
      },
    });

    const dayStart = new Date(departureRecord.clockInDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [sessionPhotos, existingReport, assignment] = await Promise.all([
      prisma.photo.findMany({
        where: {
          siteId: departureRecord.siteId,
          uploadedById: user.id,
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
          planningAssignmentId: true,
          planningAssignment: {
            select: {
              action: true,
              status: true,
            },
          },
        },
      }),
      prisma.report.findUnique({
        where: {
          clockInRecordId: departureRecord.id,
        },
        select: {
          id: true,
        },
      }),
      prisma.planningAssignment.findFirst({
        where: {
          date: departureRecord.clockInDate,
          siteId: departureRecord.siteId,
          supervisorId: user.id,
          deletedAt: null,
          workLocationType: PlanningWorkLocationType.ON_SITE,
        },
        select: {
          id: true,
          action: true,
          targetProgress: true,
          siteId: true,
          site: {
            select: {
              name: true,
            },
          },
        },
      }),
    ]);

    const arrivalAt = arrivalRecord?.timestampLocal ?? departureRecord.timestampLocal;
    const durationSeconds = Math.max(
      0,
      Math.floor((departureRecord.timestampLocal.getTime() - arrivalAt.getTime()) / 1000),
    );
    const pauseDurationSeconds = 0;
    const effectiveDurationSeconds = durationSeconds - pauseDurationSeconds;

    const sessionData: SessionReportData = {
      session: {
        id: departureRecord.id,
        siteId: departureRecord.site.id,
        siteName: departureRecord.site.name,
        siteAddress: departureRecord.site.address,
        date:
          departureRecord.clockInDate.toISOString().split('T')[0] ??
          departureRecord.clockInDate.toISOString(),
        arrivalAt: arrivalAt.toISOString(),
        departureAt: departureRecord.timestampLocal.toISOString(),
        durationSeconds,
        pauseDurationSeconds,
        effectiveDurationSeconds,
        photoCount: sessionPhotos.length,
        clockInRecordId: departureRecord.id,
      },
      ...(assignment
        ? {
            assignment: {
              id: assignment.id,
              action: assignment.action,
              ...(assignment.targetProgress !== null
                ? { targetProgress: assignment.targetProgress }
                : {}),
              siteId: assignment.siteId,
              siteName: assignment.site.name,
            },
          }
        : {}),
      photos: sessionPhotos.map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        url: createInternalPhotoUrl(photo.id),
        takenAt: photo.takenAt.toISOString(),
        planningAssignmentId: photo.planningAssignmentId,
        ...(photo.planningAssignment
          ? {
              assignmentAction: photo.planningAssignment.action,
              assignmentStatus: photo.planningAssignment.status,
            }
          : {}),
        ...(photo.description ? { description: photo.description } : {}),
        thumbnail: createInternalPhotoUrl(photo.id),
      })),
      hasExistingReport: Boolean(existingReport),
      ...(existingReport ? { existingReportId: existingReport.id } : {}),
    };

    return Response.json(sessionData);
  } catch (error) {
    console.error('Session report data error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des données de session' },
      { status: 500 },
    );
  }
});
