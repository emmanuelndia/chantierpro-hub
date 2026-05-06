import { ClockInStatus, ClockInType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';
import type {
  CoordinatorReportsResponse,
  PendingReport,
  ReceivedReport,
} from '@/types/mobile-reports';

export const GET = withAuth(async ({ user, req }) => {
  if (user.role !== Role.COORDINATOR) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const selectedSiteId = searchParams.get('siteId');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const operationalSiteIds = await getOperationalSiteIds(prisma, user.id);
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
        sites: [],
      };

      return Response.json(emptyResponse);
    }

    const [sites, completedRecords, submittedReports] = await Promise.all([
      prisma.site.findMany({
        where: { id: { in: operationalSiteIds } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.clockInRecord.findMany({
        where: {
          siteId: { in: siteIds },
          clockInDate: today,
          status: ClockInStatus.VALID,
          type: ClockInType.DEPARTURE,
          user: { role: Role.SUPERVISOR },
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
            gte: today,
            lt: tomorrow,
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
      sites,
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
