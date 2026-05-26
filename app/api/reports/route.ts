import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { Prisma, Role } from '@prisma/client';
import { getOperationalSiteIds } from '@/lib/dashboard';
import {
  BUSINESS_FIELD_RESOURCE_ROLES,
  getBusinessManagedResourceRoles,
  isBusinessManagerRole,
} from '@/lib/field-roles';

export const GET = withAuth(async ({ user }) => {
  try {
    const where: Prisma.ReportWhereInput = {};
    
    if (user.role === Role.SUPERVISOR || BUSINESS_FIELD_RESOURCE_ROLES.includes(user.role)) {
      where.userId = user.id;
    }

    if (user.role === Role.COORDINATOR) {
      const siteIds = await getOperationalSiteIds(prisma, user.id);
      where.siteId = { in: siteIds };
    }

    if (isBusinessManagerRole(user.role)) {
      where.site = {
        planningAssignments: {
          some: {
            deletedAt: null,
            supervisor: {
              role: { in: [...getBusinessManagedResourceRoles(user.role)] },
              isActive: true,
            },
          },
        },
      };
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
    return NextResponse.json({ error: 'Erreur lors de la recuperation des rapports' }, { status: 500 });
  }
});
