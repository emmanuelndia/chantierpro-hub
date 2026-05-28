import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { BUSINESS_FIELD_RESOURCE_ROLES } from '@/lib/field-roles';
import { Prisma, ReportStatus, Role } from '@prisma/client';

type CreateSiteReportBody = {
  content: string;
  clockInRecordId: string;
  progression?: number | null;
  blocage?: string | null;
};

function parseCreateSiteReportBody(value: unknown): CreateSiteReportBody | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const content = typeof record.content === 'string' ? record.content.trim() : '';
  const clockInRecordId = typeof record.clockInRecordId === 'string' ? record.clockInRecordId : '';

  if (!content || !clockInRecordId) {
    return null;
  }

  return {
    content,
    clockInRecordId,
    progression: typeof record.progression === 'number' ? record.progression : null,
    blocage: typeof record.blocage === 'string' ? record.blocage : null,
  };
}

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  try {
    const body = parseCreateSiteReportBody(await req.json().catch(() => null));

    if (!body) {
      return NextResponse.json({ error: 'Contenu requis' }, { status: 400 });
    }

    // Vérifier que clockInRecordId appartient au user
    const clockIn = await prisma.clockInRecord.findFirst({
      where: { id: body.clockInRecordId, userId: user.id }
    });
    if (!clockIn) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 400 });
    }

    // Vérifier qu'il n'y a pas déjà un rapport pour cette session
    const existing = await prisma.report.findUnique({
      where: { clockInRecordId: body.clockInRecordId }
    });
    if (existing) {
      return NextResponse.json({ error: 'Rapport déjà soumis' }, { status: 409 });
    }

    const report = await prisma.report.create({
      data: {
        siteId: params.id,
        userId: user.id,
        clockInRecordId: body.clockInRecordId,
        content: body.content,
        progression: body.progression ?? null,
        blocage: body.blocage ?? null,
        status: ReportStatus.RECU
      }
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error('Error creating report:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
});

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  try {
    // Filtre selon le rôle
    const where: Prisma.ReportWhereInput = { siteId: params.id };
    if (user.role === Role.SUPERVISOR || user.role === Role.RESOURCE || BUSINESS_FIELD_RESOURCE_ROLES.includes(user.role)) {
      where.userId = user.id; // ne voit que ses propres rapports
    }

    const reports = await prisma.report.findMany({
      where,
      include: {
        user: { 
          select: { 
            id: true, 
            firstName: true, 
            lastName: true, 
            role: true 
          } 
        },
        site: { 
          select: { 
            id: true, 
            name: true 
          } 
        },
        clockInRecord: { 
          select: { 
            clockInDate: true, 
            clockInTime: true 
          } 
        }
      },
      orderBy: { submittedAt: 'desc' }
    });

    return NextResponse.json({ data: reports, total: reports.length });
  } catch (error) {
    console.error('Error fetching reports:', error);
    return NextResponse.json({ error: 'Erreur lors de la récupération des rapports' }, { status: 500 });
  }
});
