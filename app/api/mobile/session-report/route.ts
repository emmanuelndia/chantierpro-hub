import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { NextRequest } from 'next/server';
import type { SubmitReportRequest, ReportSubmissionResponse } from '@/types/mobile-session-report';

export const POST = withAuth(async ({ user, request }) => {
  const allowedRoles = ['SUPERVISOR', 'COORDINATOR', 'GENERAL_SUPERVISOR'];
  
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const body: SubmitReportRequest = await request.json();

  const { clockInRecordId, content, progressPercentage, blockageNote, assignmentId, photoIds } = body;

  if (!clockInRecordId || !content.trim()) {
    return Response.json(
      { code: 'INVALID_REQUEST', message: 'Champs obligatoires manquants' },
      { status: 400 }
    );
  }

  try {
    // Vérifier que la session appartient à l'utilisateur
    const clockInRecord = await prisma.clockInRecord.findFirst({
      where: {
        id: clockInRecordId,
        userId: user.id,
        departureAt: { not: null }, // La session doit être terminée
      },
      include: {
        site: true,
        user: true,
      },
    });

    if (!clockInRecord) {
      return Response.json(
        { code: 'SESSION_NOT_FOUND', message: 'Session non trouvée ou non terminée' },
        { status: 404 }
      );
    }

    // Vérifier si un rapport existe déjà pour cette session
    const existingReport = await prisma.report.findFirst({
      where: {
        clockInRecordId: clockInRecord.id,
      },
    });

    if (existingReport) {
      return Response.json(
        { code: 'REPORT_ALREADY_EXISTS', message: 'Un rapport existe déjà pour cette session' },
        { status: 409 }
      );
    }

    // Créer le rapport
    const report = await prisma.report.create({
      data: {
        content: content.trim(),
        progressPercentage,
        blockageNote: blockageNote?.trim() || null,
        status: 'SUBMITTED',
        authorId: user.id,
        siteId: clockInRecord.siteId,
        clockInRecordId: clockInRecord.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    // Associer les photos au rapport
    if (photoIds && photoIds.length > 0) {
      // Note: Simulation car le modèle Photo n'a pas authorId dans le schema actuel
      const validPhotoIds = await prisma.photo.findMany({
        where: {
          id: { in: photoIds },
          clockInRecordId: clockInRecord.id,
        },
        select: { id: true },
      });

      if (validPhotoIds.length > 0) {
        // Mettre à jour les photos pour les lier au rapport
        await prisma.photo.updateMany({
          where: {
            id: { in: validPhotoIds.map(p => p.id) },
          },
          data: {
            reportId: report.id,
          },
        });
      }
    }

    // Créer une notification pour les coordinateurs et superviseurs généraux
    // TODO: Implémenter la logique de notification selon la hiérarchie

    // Note: Journalisation de l'action (simulation)
    // En production, un modèle ActivityLog devrait être ajouté au schema Prisma
    console.log('Report submitted:', {
      userId: user.id,
      action: 'SUBMIT_REPORT',
      reportId: report.id,
      details: {
        authorName: `${user.firstName} ${user.lastName}`,
        siteName: clockInRecord.site.name,
        progressPercentage,
        hasBlockage: !!blockageNote,
        photoCount: photoIds?.length || 0,
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
      { status: 500 }
    );
  }
});
