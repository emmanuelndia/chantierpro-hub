import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  try {
    const { content, clockInRecordId, progression, blocage } = await req.json();

    if (!content || content.trim() === '') {
      return NextResponse.json({ error: 'Contenu requis' }, { status: 400 });
    }

    // Vérifier que clockInRecordId appartient au user
    const clockIn = await prisma.clockInRecord.findFirst({
      where: { id: clockInRecordId, userId: user.id }
    });
    if (!clockIn) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 400 });
    }

    // Vérifier qu'il n'y a pas déjà un rapport pour cette session
    const existing = await prisma.report.findUnique({
      where: { clockInRecordId }
    });
    if (existing) {
      return NextResponse.json({ error: 'Rapport déjà soumis' }, { status: 409 });
    }

    const report = await prisma.report.create({
      data: {
        siteId: params.id,
        userId: user.id,
        clockInRecordId,
        content,
        progression: progression ?? null,
        blocage: blocage ?? null,
        status: 'RECU'
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
    const where: any = { siteId: params.id };
    if (user.role === 'SUPERVISOR') {
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
