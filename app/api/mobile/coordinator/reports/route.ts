import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import type { NextRequest } from 'next/server';
import {
  CoordinatorReportsResponse,
  PendingReport,
  ReceivedReport,
  ReportStatus,
} from '@/types/mobile-reports';

export const GET = withAuth(async ({ user, request }) => {
  if (user.role !== 'COORDINATOR') {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') || 'all';
  const siteId = searchParams.get('siteId');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    // Récupérer les sites du coordinateur
    const coordinatorSites = await prisma.site.findMany({
      where: {
        coordinatorId: user.id,
      },
      include: {
        assignments: {
          where: {
            user: {
              role: 'SUPERVISOR',
            },
          },
          include: {
            user: true,
          },
        },
      },
    });

    const supervisorIds = coordinatorSites.flatMap(site => 
      site.assignments.map(assignment => assignment.user.id)
    );

    // Sessions terminées aujourd'hui pour les superviseurs
    const completedSessions = await prisma.clockInSession.findMany({
      where: {
        userId: {
          in: supervisorIds,
        },
        departureAt: {
          not: null,
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        user: true,
        site: true,
      },
    });

    // Rapports soumis aujourd'hui
    const submittedReports = await prisma.report.findMany({
      where: {
        authorId: {
          in: supervisorIds,
        },
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        author: true,
        site: true,
        photos: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculer les rapports en attente
    const pendingReports: PendingReport[] = [];
    for (const session of completedSessions) {
      const existingReport = submittedReports.find(
        report => report.authorId === session.userId && report.siteId === session.siteId
      );

      if (!existingReport) {
        const sessionEnd = new Date(session.departureAt!);
        const dueTime = new Date(sessionEnd.getTime() + 2 * 60 * 60 * 1000); // 2h après fin
        const isOverdue = new Date() > dueTime;

        pendingReports.push({
          id: `pending-${session.id}`,
          supervisorId: session.userId,
          supervisorName: session.user.lastName,
          supervisorFirstName: session.user.firstName,
          siteId: session.siteId,
          siteName: session.site.name,
          siteAddress: session.site.address,
          sessionEndedAt: session.departureAt!.toISOString(),
          reportDueAt: dueTime.toISOString(),
          isOverdue,
        });
      }
    }

    // Formater les rapports reçus
    const receivedReports: ReceivedReport[] = submittedReports.map(report => {
      const session = completedSessions.find(
        s => s.userId === report.authorId && s.siteId === report.siteId
      );

      return {
        id: report.id,
        supervisorId: report.authorId,
        supervisorName: report.author.lastName,
        supervisorFirstName: report.author.firstName,
        siteId: report.siteId,
        siteName: report.site.name,
        submittedAt: report.createdAt.toISOString(),
        content: report.content || '',
        status: report.status as ReportStatus,
        sessionDuration: session ? 
          Math.floor((new Date(session.departureAt!).getTime() - new Date(session.arrivalAt).getTime()) / 1000) 
          : undefined,
        progressPercentage: 100, // Si rapport soumis, progression = 100%
        photoCount: report.photos.length,
      };
    });

    // Calculer le résumé
    const totalExpected = completedSessions.length;
    const totalReceived = submittedReports.length;
    const pendingCount = pendingReports.length;
    const receivedCount = receivedReports.length;
    const progressPercentage = totalExpected > 0 ? (totalReceived / totalExpected) * 100 : 0;

    // Sites pour les filtres
    const sites = coordinatorSites.map(site => ({
      id: site.id,
      name: site.name,
    }));

    const response: CoordinatorReportsResponse = {
      summary: {
        totalExpected,
        totalReceived,
        pendingCount,
        receivedCount,
        progressPercentage,
      },
      pendingReports,
      receivedReports,
      sites,
    };

    return Response.json(response);
  } catch (error) {
    console.error('Coordinator reports error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des rapports' },
      { status: 500 }
    );
  }
});
