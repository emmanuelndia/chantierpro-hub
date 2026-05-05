import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async ({ user }) => {
  if (user.role !== 'COORDINATOR') {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    // Récupérer les superviseurs que le coordinateur gère
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

    // KPIs
    const activeSupervisors = await prisma.clockInSession.count({
      where: {
        userId: {
          in: supervisorIds,
        },
        departureAt: null,
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    const reportsReceivedToday = await prisma.report.count({
      where: {
        authorId: {
          in: supervisorIds,
        },
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    // Rapports en attente (superviseurs avec session terminée mais pas de rapport)
    const supervisorsWithSessions = await prisma.clockInSession.findMany({
      where: {
        userId: {
          in: supervisorIds,
        },
        departureAt: {
          not: null,
        },
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        user: true,
        site: true,
      },
    });

    const pendingReports = [];
    for (const session of supervisorsWithSessions) {
      const existingReport = await prisma.report.findFirst({
        where: {
          authorId: session.userId,
          siteId: session.siteId,
          createdAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      });

      if (!existingReport) {
        pendingReports.push({
          id: `pending-${session.id}`,
          supervisorId: session.userId,
          supervisorName: session.user.lastName,
          supervisorFirstName: session.user.firstName,
          siteId: session.siteId,
          siteName: session.site.name,
          siteAddress: session.site.address,
          sessionEndedAt: session.departureAt.toISOString(),
          reportDueAt: new Date(session.departureAt.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2h après fin de session
        });
      }
    }

    // Rapports récents
    const recentReports = await prisma.report.findMany({
      where: {
        authorId: {
          in: supervisorIds,
        },
      },
      include: {
        author: true,
        site: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    });

    const recentReportsFormatted = recentReports.map(report => ({
      id: report.id,
      supervisorName: `${report.author.firstName} ${report.author.lastName}`,
      siteName: report.site.name,
      submittedAt: report.createdAt.toISOString(),
      summary: report.content?.substring(0, 100) + '...' || 'Aucun résumé disponible',
      status: report.status as 'SUBMITTED' | 'REVIEWED' | 'APPROVED',
    }));

    const dashboard = {
      kpis: {
        activeSupervisors,
        reportsReceivedToday,
        pendingReports: pendingReports.length,
      },
      pendingReports,
      recentReports: recentReportsFormatted,
    };

    return Response.json(dashboard);
  } catch (error) {
    console.error('Coordinator dashboard error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du dashboard' },
      { status: 500 }
    );
  }
});
