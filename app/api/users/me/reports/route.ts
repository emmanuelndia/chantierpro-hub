import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async ({ user }) => {
  try {
    const reports = await prisma.report.findMany({
      where: { userId: user.id },
      include: {
        site: { select: { id: true, name: true } },
        clockInRecord: {
          select: { clockInDate: true, clockInTime: true }
        }
      },
      orderBy: { submittedAt: 'desc' }
    });
    
    return NextResponse.json({ data: reports, total: reports.length });
  } catch (error) {
    console.error('Error fetching user reports:', error);
    return NextResponse.json({ error: 'Erreur lors de la récupération des rapports' }, { status: 500 });
  }
});
