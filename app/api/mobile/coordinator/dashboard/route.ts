import { ClockInStatus, ClockInType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getCoordinatorScopedSiteIds } from '@/lib/reports';

export const GET = withAuth(async ({ user }) => {
  if (user.role !== Role.COORDINATOR) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const siteIds = await getCoordinatorScopedSiteIds(prisma, user.id);

    if (siteIds.length === 0) {
      return Response.json({
        kpis: {
          activeSupervisors: 0,
          reportsReceivedToday: 0,
          pendingReports: 0,
        },
        pendingReports: [],
        recentReports: [],
      });
    }

    const departureRecords = await prisma.clockInRecord.findMany({
      where: {
        siteId: { in: siteIds },
        clockInDate: today,
        status: ClockInStatus.VALID,
        type: ClockInType.DEPARTURE,
        user: { role: { in: [Role.SUPERVISOR, Role.RESOURCE] } },
      },
      orderBy: [{ timestampLocal: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        siteId: true,
        timestampLocal: true,
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
        report: {
          select: {
            id: true,
          },
        },
      },
    });

    const activeSupervisors = await prisma.clockInRecord.findMany({
      where: {
        siteId: { in: siteIds },
        clockInDate: today,
        status: ClockInStatus.VALID,
        user: { role: { in: [Role.SUPERVISOR, Role.RESOURCE] } },
      },
      distinct: ['userId'],
      select: { userId: true },
    });

    const reportsReceivedToday = await prisma.report.count({
      where: {
        siteId: { in: siteIds },
        submittedAt: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    const pendingReports = departureRecords
      .filter((record) => !record.report)
      .map((record) => {
        const reportDueAt = new Date(record.timestampLocal.getTime() + 2 * 60 * 60 * 1000);

        return {
          id: `pending-${record.id}`,
          supervisorId: record.userId,
          supervisorName: record.user.lastName,
          supervisorFirstName: record.user.firstName,
          siteId: record.siteId,
          siteName: record.site.name,
          siteAddress: record.site.address,
          sessionEndedAt: record.timestampLocal.toISOString(),
          reportDueAt: reportDueAt.toISOString(),
        };
      });

    const recentReports = await prisma.report.findMany({
      where: {
        siteId: { in: siteIds },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        content: true,
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
          },
        },
      },
    });

    return Response.json({
      kpis: {
        activeSupervisors: activeSupervisors.length,
        reportsReceivedToday,
        pendingReports: pendingReports.length,
      },
      pendingReports,
      recentReports: recentReports.map((report) => ({
        id: report.id,
        supervisorName: `${report.user.firstName} ${report.user.lastName}`,
        siteName: report.site.name,
        submittedAt: report.submittedAt.toISOString(),
        summary:
          report.content.length > 100
            ? `${report.content.slice(0, 100)}...`
            : report.content || 'Aucun résumé disponible',
        status: report.status,
      })),
    });
  } catch (error) {
    console.error('Coordinator dashboard error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du dashboard' },
      { status: 500 },
    );
  }
});
