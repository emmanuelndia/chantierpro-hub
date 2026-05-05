import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import type { GeneralSupervisorDashboardResponse, TodayAssignment, PriorityAlert } from '@/types/mobile-general-supervisor';

export const GET = withAuth(async ({ user }) => {
  if (user.role !== 'GENERAL_SUPERVISOR') {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    // Récupérer tous les superviseurs sous la responsabilité du superviseur général
    const supervisors = await prisma.user.findMany({
      where: {
        role: 'SUPERVISOR',
        isActive: true,
      },
      include: {
        assignments: {
          where: {
            site: {
              startDate: {
                lte: tomorrow,
              },
              OR: [
                { endDate: null },
                { endDate: { gte: today } },
              ],
            },
          },
          include: {
            site: true,
          },
        },
      },
    });

    // Récupérer les sessions de pointage du jour
    const todaySessions = await prisma.clockInSession.findMany({
      where: {
        userId: {
          in: supervisors.map(s => s.id),
        },
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        user: true,
        site: true,
      },
    });

    // Récupérer les rapports du jour
    const todayReports = await prisma.report.findMany({
      where: {
        authorId: {
          in: supervisors.map(s => s.id),
        },
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        author: true,
        site: true,
      },
    });

    // Calculer les KPIs
    const totalSupervisors = supervisors.length;
    const deployedSupervisors = supervisors.filter(s => s.assignments.length > 0).length;
    const activeSupervisorsNow = todaySessions.filter(s => !s.departureAt).length;
    const reportsReceived = todayReports.length;
    const reportsExpected = todaySessions.filter(s => s.departureAt).length;

    // Détecter les alertes
    const alerts: PriorityAlert[] = [];

    // 1. Superviseurs absents non justifiés
    const expectedSupervisors = new Set(
      supervisors
        .filter(s => s.assignments.length > 0)
        .map(s => s.id)
    );

    const presentSupervisors = new Set(todaySessions.map(s => s.userId));
    const absentSupervisors = [...expectedSupervisors].filter(id => !presentSupervisors.has(id));

    for (const supervisorId of absentSupervisors) {
      const supervisor = supervisors.find(s => s.id === supervisorId)!;
      const assignment = supervisor.assignments[0]; // Prendre la première assignation
      
      alerts.push({
        id: `absence-${supervisorId}`,
        type: 'ABSENCE',
        supervisorId,
        supervisorName: supervisor.lastName,
        supervisorFirstName: supervisor.firstName,
        siteId: assignment.siteId,
        siteName: assignment.site.name,
        severity: 'HIGH',
        message: 'Superviseur absent non justifié',
        createdAt: new Date().toISOString(),
        actionRequired: true,
      });
    }

    // 2. Sessions > 10h sans sortie
    const now = new Date();
    for (const session of todaySessions) {
      if (!session.departureAt) {
        const sessionDuration = (now.getTime() - new Date(session.arrivalAt).getTime()) / (1000 * 60 * 60); // heures
        
        if (sessionDuration > 10) {
          alerts.push({
            id: `long-session-${session.id}`,
            type: 'LONG_SESSION',
            supervisorId: session.userId,
            supervisorName: session.user.lastName,
            supervisorFirstName: session.user.firstName,
            siteId: session.siteId,
            siteName: session.site.name,
            severity: sessionDuration > 12 ? 'HIGH' : 'MEDIUM',
            message: `Session en cours depuis ${Math.floor(sessionDuration)}h`,
            createdAt: session.arrivalAt.toISOString(),
            actionRequired: true,
          });
        }
      }
    }

    // 3. Rapports en attente > 2h après fin session
    for (const session of todaySessions) {
      if (session.departureAt) {
        const sessionEnd = new Date(session.departureAt);
        const twoHoursAfter = new Date(sessionEnd.getTime() + 2 * 60 * 60 * 1000);
        
        if (now > twoHoursAfter) {
          const hasReport = todayReports.some(r => 
            r.authorId === session.userId && r.siteId === session.siteId
          );
          
          if (!hasReport) {
            alerts.push({
              id: `missing-report-${session.id}`,
              type: 'MISSING_REPORT',
              supervisorId: session.userId,
              supervisorName: session.user.lastName,
              supervisorFirstName: session.user.firstName,
              siteId: session.siteId,
              siteName: session.site.name,
              severity: 'MEDIUM',
              message: 'Rapport en attente depuis plus de 2h',
              createdAt: session.departureAt.toISOString(),
              actionRequired: true,
            });
          }
        }
      }
    }

    // Créer les assignations du jour
    const todayAssignments: TodayAssignment[] = [];
    
    for (const supervisor of supervisors) {
      for (const assignment of supervisor.assignments) {
        const session = todaySessions.find(s => 
          s.userId === supervisor.id && s.siteId === assignment.siteId
        );
        const report = todayReports.find(r => 
          r.authorId === supervisor.id && r.siteId === assignment.siteId
        );
        
        // Calculer la progression (basée sur le rapport et la session)
        let progressPercentage = 0;
        if (session?.departureAt) {
          progressPercentage = report ? 100 : 75; // Session terminée mais pas de rapport
        } else if (session) {
          const sessionProgress = (now.getTime() - new Date(session.arrivalAt).getTime()) / 
                                (9 * 60 * 60 * 1000) * 100; // 9h de travail prévu
          progressPercentage = Math.min(Math.floor(sessionProgress), 90);
        } else {
          progressPercentage = 0;
        }

        const hasAlert = alerts.some(a => 
          a.supervisorId === supervisor.id && a.siteId === assignment.siteId
        );

        todayAssignments.push({
          id: `${supervisor.id}-${assignment.siteId}`,
          supervisorId: supervisor.id,
          supervisorName: supervisor.lastName,
          supervisorFirstName: supervisor.firstName,
          siteId: assignment.siteId,
          siteName: assignment.site.name,
          siteAddress: assignment.site.address,
          progressPercentage,
          isClockedIn: !!session && !session.departureAt,
          hasAlert,
          alertType: hasAlert ? alerts.find(a => 
            a.supervisorId === supervisor.id && a.siteId === assignment.siteId
          )?.type : undefined,
        });
      }
    }

    // Vérifier si le superviseur général a une session active
    const generalSupervisorSession = todaySessions.find(s => s.userId === user.id);
    const hasActiveSession = !!generalSupervisorSession && !generalSupervisorSession.departureAt;

    const dashboard: GeneralSupervisorDashboardResponse = {
      kpis: {
        deployedSupervisors,
        totalSupervisors,
        activeSupervisorsNow,
        reportsReceived,
        reportsExpected,
        alertCount: alerts.length,
      },
      todayAssignments,
      priorityAlerts: alerts.sort((a, b) => {
        // Trier par sévérité puis par date
        const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        if (severityDiff !== 0) return severityDiff;
        
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }),
      hasActiveSession,
      sessionData: hasActiveSession && generalSupervisorSession ? {
        siteId: generalSupervisorSession.siteId,
        siteName: generalSupervisorSession.site.name,
        arrivalAt: generalSupervisorSession.arrivalAt.toISOString(),
        durationSeconds: Math.floor((now.getTime() - new Date(generalSupervisorSession.arrivalAt).getTime()) / 1000),
        isPaused: false, // TODO: Implémenter la logique de pause
      } : undefined,
    };

    return Response.json(dashboard);
  } catch (error) {
    console.error('General supervisor dashboard error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du dashboard' },
      { status: 500 }
    );
  }
});
