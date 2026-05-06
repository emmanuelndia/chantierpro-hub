import { Prisma, ReportStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import type { MobileReportsHistoryResponse, ReportSummary } from '@/types/mobile-history-reports';

const allowedRoles: readonly Role[] = [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR];

export const GET = withAuth(async ({ user, req }) => {
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') ?? 'week';
  const parsedLimit = Number(searchParams.get('limit') ?? '10');
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10;
  const cursor = searchParams.get('cursor');

  try {
    const now = new Date();
    const startDate =
      period === 'month'
        ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const where: Prisma.ReportWhereInput = {
      userId: user.id,
      createdAt: {
        gte: startDate,
        ...(cursor ? { lt: new Date(cursor) } : {}),
      },
    };

    const reports = await prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        siteId: true,
        content: true,
        progression: true,
        status: true,
        createdAt: true,
        submittedAt: true,
        site: {
          select: {
            name: true,
          },
        },
      },
    });

    const hasMore = reports.length > limit;
    const reportsData = hasMore ? reports.slice(0, -1) : reports;

    const photoCounts = await prisma.photo.groupBy({
      by: ['siteId'],
      where: {
        uploadedById: user.id,
        isDeleted: false,
        siteId: {
          in: reportsData.map((report) => report.siteId),
        },
      },
      _count: {
        _all: true,
      },
    });

    const formattedReports: ReportSummary[] = reportsData.map((report) => ({
      id: report.id,
      siteId: report.siteId,
      siteName: report.site.name,
      date: report.createdAt.toISOString().split('T')[0] ?? report.createdAt.toISOString(),
      progressPercentage: report.progression ?? 0,
      content: report.content,
      status: report.status,
      photoCount:
        photoCounts.find((count) => count.siteId === report.siteId)?._count._all ?? 0,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.submittedAt.toISOString(),
    }));

    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const [monthReports, allReports] = await Promise.all([
      prisma.report.count({
        where: {
          userId: user.id,
          createdAt: {
            gte: currentMonth,
          },
        },
      }),
      prisma.report.findMany({
        where: {
          userId: user.id,
        },
        select: {
          progression: true,
          status: true,
        },
      }),
    ]);

    const averageProgress =
      allReports.length > 0
        ? allReports.reduce((sum, report) => sum + (report.progression ?? 0), 0) /
          allReports.length
        : 0;

    const reportsByStatus: Record<ReportStatus, number> = {
      RECU: allReports.filter((report) => report.status === ReportStatus.RECU).length,
      EN_REVUE: allReports.filter((report) => report.status === ReportStatus.EN_REVUE).length,
      VALIDE: allReports.filter((report) => report.status === ReportStatus.VALIDE).length,
      ENVOYE: allReports.filter((report) => report.status === ReportStatus.ENVOYE).length,
    };

    const lastReport = reportsData.at(-1);
    const response: MobileReportsHistoryResponse = {
      reports: formattedReports,
      statistics: {
        reportsSubmittedThisMonth: monthReports,
        averageProgressDeclared: averageProgress,
        totalReports: allReports.length,
        reportsByStatus,
      },
      hasMore,
      ...(hasMore && lastReport ? { nextCursor: lastReport.createdAt.toISOString() } : {}),
    };

    return Response.json(response);
  } catch (error) {
    console.error('Mobile reports history error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des rapports' },
      { status: 500 },
    );
  }
});
