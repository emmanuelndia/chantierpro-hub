import { ClockInStatus, ClockInType, ReportStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import type { ReportSubmissionResponse, SubmitReportRequest } from '@/types/mobile-session-report';

const allowedRoles: readonly Role[] = [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR];

export const POST = withAuth(async ({ user, req }) => {
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as SubmitReportRequest | null;
  const content = body?.content?.trim();

  if (!body?.clockInRecordId || !content) {
    return Response.json(
      { code: 'INVALID_REQUEST', message: 'Champs obligatoires manquants' },
      { status: 400 },
    );
  }

  try {
    const clockInRecord = await prisma.clockInRecord.findFirst({
      where: {
        id: body.clockInRecordId,
        userId: user.id,
        status: ClockInStatus.VALID,
        type: ClockInType.DEPARTURE,
      },
      select: {
        id: true,
        siteId: true,
        site: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!clockInRecord) {
      return Response.json(
        { code: 'SESSION_NOT_FOUND', message: 'Session non trouvée ou non terminée' },
        { status: 404 },
      );
    }

    const existingReport = await prisma.report.findUnique({
      where: {
        clockInRecordId: clockInRecord.id,
      },
      select: {
        id: true,
      },
    });

    if (existingReport) {
      return Response.json(
        { code: 'REPORT_ALREADY_EXISTS', message: 'Un rapport existe déjà pour cette session' },
        { status: 409 },
      );
    }

    const report = await prisma.report.create({
      data: {
        content,
        progression: body.progressPercentage,
        blocage: body.blockageNote?.trim() ?? null,
        status: ReportStatus.RECU,
        userId: user.id,
        siteId: clockInRecord.siteId,
        clockInRecordId: clockInRecord.id,
      },
      select: {
        id: true,
      },
    });

    const response: ReportSubmissionResponse = {
      success: true,
      reportId: report.id,
      message: 'Rapport soumis avec succès',
      isOffline: false,
    };

    return Response.json(response);
  } catch (error) {
    console.error('Submit report error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors de la soumission du rapport' },
      { status: 500 },
    );
  }
});
