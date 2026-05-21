import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { Prisma, Role } from '@prisma/client';
import { getOperationalSiteIds } from '@/lib/dashboard';

export const GET = withAuth(async ({ user }) => {
  try {
    const where: Prisma.ReportWhereInput = {};
    
    if (user.role === Role.SUPERVISOR) {
      where.userId = user.id;
    }

    if (user.role === Role.COORDINATOR) {
      const siteIds = await getOperationalSiteIds(prisma, user.id);
      where.siteId = { in: siteIds };
    }

    const reports = await prisma.report.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        site: { select: { id: true, name: true } },
        clockInRecord: { select: { clockInDate: true, clockInTime: true } }
      },
      orderBy: { submittedAt: 'desc' }
    });

    return NextResponse.json({ data: reports, total: reports.length });
  } catch (error) {
    console.error('Error fetching all reports:', error);
    return NextResponse.json({ error: 'Erreur lors de la récupération des rapports' }, { status: 500 });
  }
});
