import { ClockInStatus, ClockInType, PlanningAssignmentStatus, PlanningWorkLocationType, ReportStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createDocumentAttachment } from '@/lib/documents';
import { FIELD_USER_ROLES } from '@/lib/field-roles';
import type { ReportSubmissionResponse, SubmitReportRequest } from '@/types/mobile-session-report';

const allowedRoles: readonly Role[] = FIELD_USER_ROLES;

export const POST = withAuth(async ({ user, req }) => {
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const parsed = await parseSessionReportRequest(req);
  const body = parsed?.body ?? null;
  const file = parsed?.file ?? null;
  const content = body?.content?.trim() ?? '';

  if (!body?.clockInRecordId || (!content && !file)) {
    return Response.json(
      { code: 'INVALID_REQUEST', message: 'Ajoutez un texte ou un fichier au rapport.' },
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

    if (body.assignmentId) {
      const assignment = await prisma.planningAssignment.findFirst({
        where: {
          id: body.assignmentId,
          supervisorId: user.id,
          siteId: clockInRecord.siteId,
          deletedAt: null,
          workLocationType: PlanningWorkLocationType.ON_SITE,
        },
        select: {
          id: true,
        },
      });

      if (!assignment) {
        return Response.json(
          { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignation introuvable pour cette session' },
          { status: 404 },
        );
      }
    }

    const photoIds = body.photoIds ?? [];

    if (photoIds.length > 0) {
      const photosCount = await prisma.photo.count({
        where: {
          id: { in: photoIds },
          siteId: clockInRecord.siteId,
          uploadedById: user.id,
          isDeleted: false,
          ...(body.assignmentId ? { OR: [{ planningAssignmentId: body.assignmentId }, { planningAssignmentId: null }] } : {}),
        },
      });

      if (photosCount !== new Set(photoIds).size) {
        return Response.json(
          { code: 'PHOTO_SCOPE_INVALID', message: 'Une ou plusieurs photos sont hors périmètre' },
          { status: 400 },
        );
      }
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

    if (file) {
      const documentResult = await createDocumentAttachment(prisma, {
        user,
        file,
        context: {
          projectId: null,
          siteId: null,
          reportId: report.id,
        },
      });

      if (documentResult.code) {
        await prisma.report.delete({ where: { id: report.id } }).catch(() => null);
        const status = documentResult.code === 'UPLOAD_FAILED' ? 500 : 400;
        return Response.json(
          { code: documentResult.code, message: "Le fichier du rapport n'a pas pu etre ajoute." },
          { status },
        );
      }
    }

    if (body.assignmentId) {
      await prisma.planningAssignment.update({
        where: { id: body.assignmentId },
        data: { status: PlanningAssignmentStatus.COMPLETED },
      });

      await prisma.taskProgressUpdate.create({
        data: {
          assignmentId: body.assignmentId,
          progress: body.progressPercentage,
          comment: content.trim() ? content : (body.blockageNote?.trim() ?? null),
          blocked: Boolean(body.blockageNote?.trim()),
          completed: true,
          createdById: user.id,
        },
      });
    }

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

async function parseSessionReportRequest(req: Request): Promise<{ body: SubmitReportRequest; file: File | null } | null> {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return null;
    }

    const fileValue = formData.get('file');
    return {
      file: fileValue instanceof File ? fileValue : null,
      body: {
        clockInRecordId: stringValue(formData.get('clockInRecordId')),
        content: stringValue(formData.get('content')),
        progressPercentage: numberValue(formData.get('progressPercentage')),
        blockageNote: optionalStringValue(formData.get('blockageNote')),
        assignmentId: optionalStringValue(formData.get('assignmentId')),
      },
    };
  }

  return {
    file: null,
    body: ((await req.json().catch(() => null)) as SubmitReportRequest | null) ?? {
      clockInRecordId: '',
      content: '',
      progressPercentage: 0,
    },
  };
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value : '';
}

function optionalStringValue(value: FormDataEntryValue | null) {
  const text = stringValue(value).trim();
  return text || undefined;
}

function numberValue(value: FormDataEntryValue | null) {
  const parsed = Number(stringValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
