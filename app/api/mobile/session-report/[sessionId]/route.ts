import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createInternalPhotoUrl } from '@/lib/photos';
import type { SessionReportData } from '@/types/mobile-session-report';

export const GET = withAuth(async ({ user, params }) => {
  const allowedRoles = ['SUPERVISOR', 'COORDINATOR', 'GENERAL_SUPERVISOR'];

  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { sessionId } = params;

  try {
    const clockInRecord = await prisma.clockInRecord.findFirst({
      where: {
        id: sessionId as string,
        userId: user.id,
      },
      include: {
        site: true,
        user: true,
      },
    });

    if (!clockInRecord) {
      return Response.json(
        { code: 'SESSION_NOT_FOUND', message: 'Session non trouvee' },
        { status: 404 },
      );
    }

    if (!clockInRecord.departureAt) {
      return Response.json(
        { code: 'SESSION_NOT_COMPLETED', message: "La session n'est pas terminee" },
        { status: 400 },
      );
    }

    const durationSeconds = Math.floor(
      (new Date(clockInRecord.departureAt).getTime() - new Date(clockInRecord.arrivalAt).getTime()) / 1000,
    );
    const pauseDurationSeconds = 0;
    const effectiveDurationSeconds = durationSeconds - pauseDurationSeconds;

    const sessionPhotos = await prisma.photo.findMany({
      where: {
        clockInRecordId: clockInRecord.id,
      },
      orderBy: {
        takenAt: 'asc',
      },
    });

    const existingReport = await prisma.report.findFirst({
      where: {
        clockInRecordId: clockInRecord.id,
      },
    });

    const dayAssignment = null;

    const sessionData: SessionReportData = {
      session: {
        id: clockInRecord.id,
        siteId: clockInRecord.site.id,
        siteName: clockInRecord.site.name,
        siteAddress: clockInRecord.site.address,
        date: clockInRecord.date.toISOString().split('T')[0],
        arrivalAt: clockInRecord.arrivalAt.toISOString(),
        departureAt: clockInRecord.departureAt.toISOString(),
        durationSeconds,
        pauseDurationSeconds,
        effectiveDurationSeconds,
        photoCount: sessionPhotos.length,
        clockInRecordId: clockInRecord.id,
      },
      assignment: dayAssignment,
      photos: sessionPhotos.map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        url: createInternalPhotoUrl(photo.id),
        takenAt: photo.takenAt.toISOString(),
        description: photo.description,
        thumbnail: createInternalPhotoUrl(photo.id),
      })),
      hasExistingReport: Boolean(existingReport),
      existingReportId: existingReport?.id,
    };

    return Response.json(sessionData);
  } catch (error) {
    console.error('Session report data error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des donnees de session' },
      { status: 500 },
    );
  }
});
