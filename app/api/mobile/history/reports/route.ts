import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import type { MobileReportsHistoryResponse } from '@/types/mobile-history-reports';

export const GET = withAuth(async ({ user, request }) => {
  const allowedRoles = ['SUPERVISOR', 'COORDINATOR', 'GENERAL_SUPERVISOR'];
  
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'week';
  const limit = parseInt(searchParams.get('limit') || '10');
  const cursor = searchParams.get('cursor');

  try {
    // Calculer la date de début selon la période
    const now = new Date();
    let startDate: Date;
    
    if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Construire la clause where pour la pagination
    const whereClause: any = {
      authorId: user.id, // Un superviseur ne voit que ses propres rapports
      createdAt: {
        gte: startDate,
      },
    };

    if (cursor) {
      whereClause.createdAt = {
        ...whereClause.createdAt,
        lt: new Date(cursor),
      };
    }

    // Récupérer les rapports
    const reports = await prisma.report.findMany({
      where: whereClause,
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
        photos: {
          select: {
            id: true,
          },
        },
        clockInRecord: {
          select: {
            arrivalAt: true,
            departureAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit + 1, // +1 pour vérifier s'il y a plus de résultats
    });

    const hasMore = reports.length > limit;
    const reportsData = hasMore ? reports.slice(0, -1) : reports;

    // Formater les rapports
    const formattedReports = reportsData.map(report => ({
      id: report.id,
      siteId: report.site.id,
      siteName: report.site.name,
      date: report.createdAt.toISOString().split('T')[0],
      progressPercentage: report.progressPercentage || 0,
      content: report.content || '',
      status: report.status as any,
      photoCount: report.photos.length,
      coordinatorComment: undefined, // TODO: Implémenter depuis un modèle de commentaires
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    }));

    // Calculer les statistiques
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const monthReports = await prisma.report.count({
      where: {
        authorId: user.id,
        createdAt: {
          gte: currentMonth,
        },
      },
    });

    const allReports = await prisma.report.findMany({
      where: {
        authorId: user.id,
      },
      select: {
        progressPercentage: true,
        status: true,
      },
    });

    const averageProgress = allReports.length > 0 
      ? allReports.reduce((sum, r) => sum + (r.progressPercentage || 0), 0) / allReports.length 
      : 0;

    const reportsByStatus = {
      SUBMITTED: allReports.filter(r => r.status === 'SUBMITTED').length,
      REVIEWED: allReports.filter(r => r.status === 'REVIEWED').length,
      VALIDATED: allReports.filter(r => r.status === 'VALIDATED').length,
      SENT: allReports.filter(r => r.status === 'SENT').length,
    };

    const statistics = {
      reportsSubmittedThisMonth: monthReports,
      averageProgressDeclared: averageProgress,
      totalReports: allReports.length,
      reportsByStatus,
    };

    const response: MobileReportsHistoryResponse = {
      reports: formattedReports,
      statistics,
      hasMore,
      nextCursor: hasMore ? reports[reports.length - 1].createdAt.toISOString() : undefined,
    };

    return Response.json(response);
  } catch (error) {
    console.error('Mobile reports history error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des rapports' },
      { status: 500 }
    );
  }
});
