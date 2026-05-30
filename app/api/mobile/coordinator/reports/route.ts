import { ClockInStatus, ClockInType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getCoordinatorScopedSiteIds } from '@/lib/reports';
import type {
  CoordinatorReportsResponse,
  MobileReportCoveragePeriod,
  PendingReport,
  ReceivedReport,
} from '@/types/mobile-reports';

export const GET = withAuth(async ({ user, req }) => {
  if (user.role !== Role.COORDINATOR) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const selectedSiteId = searchParams.get('siteId');
  const coveragePeriod: MobileReportCoveragePeriod = searchParams.get('coveragePeriod') === 'week' ? 'week' : 'today';
  const reportRange = buildReportRange(coveragePeriod);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const operationalSiteIds = await getCoordinatorScopedSiteIds(prisma, user.id);
    const siteIds =
      selectedSiteId && operationalSiteIds.includes(selectedSiteId)
        ? [selectedSiteId]
        : operationalSiteIds;

    if (siteIds.length === 0) {
      const emptyResponse: CoordinatorReportsResponse = {
        summary: {
          totalExpected: 0,
          totalReceived: 0,
          pendingCount: 0,
          receivedCount: 0,
          progressPercentage: 0,
        },
        pendingReports: [],
        receivedReports: [],
        siteCoverage: [],
        sites: [],
      };

      return Response.json(emptyResponse);
    }

    const [sites, completedRecords, submittedReports] = await Promise.all([
      prisma.site.findMany({
        where: { id: { in: siteIds } },
        orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          projectId: true,
          project: {
            select: {
              name: true,
              projectManager: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      }),
      prisma.clockInRecord.findMany({
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
      }),
      prisma.report.findMany({
        where: {
          siteId: { in: siteIds },
          submittedAt: {
            gte: reportRange.from,
            lt: reportRange.to,
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          userId: true,
          siteId: true,
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
          clockInRecord: {
            select: {
              timestampLocal: true,
            },
          },
        },
      }),
    ]);

    const photoCounts = await prisma.photo.groupBy({
      by: ['siteId', 'uploadedById'],
      where: {
        siteId: { in: siteIds },
        isDeleted: false,
        timestampLocal: {
          gte: today,
          lt: tomorrow,
        },
      },
      _count: {
        _all: true,
      },
    });

    const pendingReports: PendingReport[] = completedRecords
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
          isOverdue: new Date() > reportDueAt,
        };
      });

    const receivedReports: ReceivedReport[] = submittedReports.map((report) => {
      const photoCount =
        photoCounts.find(
          (count) => count.siteId === report.siteId && count.uploadedById === report.userId,
        )?._count._all ?? 0;

      return {
        id: report.id,
        supervisorId: report.userId,
        supervisorName: report.user.lastName,
        supervisorFirstName: report.user.firstName,
        siteId: report.siteId,
        siteName: report.site.name,
        submittedAt: report.submittedAt.toISOString(),
        content: report.content,
        status: report.status,
        progressPercentage: 100,
        sessionDuration: Math.max(
          0,
          Math.floor(
            (report.submittedAt.getTime() - report.clockInRecord.timestampLocal.getTime()) / 1000,
          ),
        ),
        photoCount,
      };
    });

    const totalExpected = completedRecords.length;
    const totalReceived = submittedReports.length;
    const reportsBySite = new Map<string, typeof submittedReports>();

    for (const report of submittedReports) {
      const current = reportsBySite.get(report.siteId) ?? [];
      current.push(report);
      reportsBySite.set(report.siteId, current);
    }

    const response: CoordinatorReportsResponse = {
      summary: {
        totalExpected,
        totalReceived,
        pendingCount: pendingReports.length,
        receivedCount: receivedReports.length,
        progressPercentage: totalExpected > 0 ? (totalReceived / totalExpected) * 100 : 0,
      },
      pendingReports,
      receivedReports,
      siteCoverage: sites.map((site) => {
        const reports = reportsBySite.get(site.id) ?? [];
        const latestReport = reports[0] ?? null;

        return {
          projectId: site.projectId,
          projectName: site.project.name,
          projectManagerName: `${site.project.projectManager.firstName} ${site.project.projectManager.lastName}`,
          siteId: site.id,
          siteName: site.name,
          reportsCount: reports.length,
          latestReportAt: latestReport?.submittedAt.toISOString() ?? null,
          latestReportAuthorName: latestReport
            ? `${latestReport.user.firstName} ${latestReport.user.lastName}`
            : null,
          status: reports.length > 0 ? 'RECEIVED' : 'MISSING',
        };
      }),
      sites: sites.map((site) => ({
        id: site.id,
        name: site.name,
      })),
    };

    return Response.json(response);
  } catch (error) {
    console.error('Coordinator reports error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des rapports' },
      { status: 500 },
    );
  }
});

function buildReportRange(period: MobileReportCoveragePeriod) {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

  if (period === 'week') {
    const day = todayStart.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const from = new Date(todayStart);
    from.setUTCDate(todayStart.getUTCDate() + mondayOffset);
    const to = new Date(from);
    to.setUTCDate(from.getUTCDate() + 7);
    return { from, to };
  }

  const to = new Date(todayStart);
  to.setUTCDate(todayStart.getUTCDate() + 1);
  return { from: todayStart, to };
}
