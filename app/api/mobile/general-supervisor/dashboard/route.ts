import { ClockInStatus, ClockInType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getBusinessManagedResourceRoles, isBusinessManagerRole } from '@/lib/field-roles';
import type {
  GeneralSupervisorDashboardResponse,
  PriorityAlert,
  TodayAssignment,
} from '@/types/mobile-general-supervisor';

export const GET = withAuth(async ({ user }) => {
  if (user.role !== Role.GENERAL_SUPERVISOR && !isBusinessManagerRole(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const assignments = await prisma.planningAssignment.findMany({
      where: {
        date: today,
        deletedAt: null,
        ...(isBusinessManagerRole(user.role)
          ? {
              supervisor: {
                role: { in: [...getBusinessManagedResourceRoles(user.role)] },
                isActive: true,
              },
            }
          : {
              createdById: user.id,
            }),
      },
      orderBy: [{ site: { name: 'asc' } }, { supervisor: { lastName: 'asc' } }],
      select: {
        id: true,
        supervisorId: true,
        siteId: true,
        targetProgress: true,
        objectiveText: true,
        progressUpdates: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            progress: true,
            blocked: true,
            completed: true,
          },
        },
        supervisor: {
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
      },
    });

    const supervisorIds = [...new Set(assignments.map((assignment) => assignment.supervisorId))];
    const siteIds = [...new Set(assignments.map((assignment) => assignment.siteId))];

    const [records, todayReports] = await Promise.all([
      prisma.clockInRecord.findMany({
        where: {
          clockInDate: today,
          status: ClockInStatus.VALID,
          OR: [
            { userId: { in: supervisorIds } },
            { userId: user.id },
          ],
          ...(siteIds.length > 0 ? { siteId: { in: siteIds } } : {}),
        },
        orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          userId: true,
          siteId: true,
          type: true,
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
            },
          },
        },
      }),
      prisma.report.findMany({
        where: {
          submittedAt: {
            gte: today,
            lt: tomorrow,
          },
          userId: { in: supervisorIds },
          siteId: { in: siteIds },
        },
        select: {
          id: true,
          userId: true,
          siteId: true,
        },
      }),
    ]);

    const now = new Date();
    const alerts: PriorityAlert[] = [];
    const todayAssignments: TodayAssignment[] = assignments.map((assignment) => {
      const latestProgressUpdate = assignment.progressUpdates[0] ?? null;
      const actualProgress = latestProgressUpdate?.progress ?? null;
      const progressDelta =
        assignment.targetProgress !== null && actualProgress !== null
          ? actualProgress - assignment.targetProgress
          : null;
      const objectiveStatus = latestProgressUpdate?.blocked
        ? 'BLOCKED'
        : latestProgressUpdate?.completed ||
            (assignment.targetProgress !== null && actualProgress !== null && actualProgress >= assignment.targetProgress)
          ? 'ACHIEVED'
          : actualProgress !== null || latestProgressUpdate
            ? 'PARTIAL'
            : 'NOT_STARTED';
      const assignmentRecords = records.filter(
        (record) => record.userId === assignment.supervisorId && record.siteId === assignment.siteId,
      );
      const latestRecord = assignmentRecords.at(-1);
      const departureRecord = [...assignmentRecords]
        .reverse()
        .find((record) => record.type === ClockInType.DEPARTURE);
      const report = todayReports.find(
        (item) => item.userId === assignment.supervisorId && item.siteId === assignment.siteId,
      );

      const isClockedIn = Boolean(
        latestRecord &&
          latestRecord.type !== ClockInType.DEPARTURE &&
          latestRecord.type !== ClockInType.PAUSE_START,
      );

      let progressPercentage = 0;
      if (actualProgress !== null) {
        progressPercentage = actualProgress;
      } else if (report) {
        progressPercentage = 100;
      } else if (departureRecord) {
        progressPercentage = 75;
      } else if (isClockedIn && latestRecord) {
        const elapsed = now.getTime() - latestRecord.timestampLocal.getTime();
        progressPercentage = Math.min(90, Math.max(5, Math.floor(elapsed / (9 * 60 * 60 * 10))));
      } else if (assignment.targetProgress !== null) {
        progressPercentage = assignment.targetProgress;
      }

      const assignmentAlerts: PriorityAlert[] = [];

      if (!latestRecord) {
        assignmentAlerts.push({
          id: `absence-${assignment.id}`,
          type: 'ABSENCE',
          supervisorId: assignment.supervisorId,
          supervisorName: assignment.supervisor.lastName,
          supervisorFirstName: assignment.supervisor.firstName,
          siteId: assignment.siteId,
          siteName: assignment.site.name,
          severity: 'HIGH',
          message: 'Superviseur absent non justifié',
          createdAt: now.toISOString(),
          actionRequired: true,
        });
      }

      if (latestRecord && isClockedIn) {
        const sessionDurationHours =
          (now.getTime() - latestRecord.timestampLocal.getTime()) / (1000 * 60 * 60);

        if (sessionDurationHours > 10) {
          assignmentAlerts.push({
            id: `long-session-${assignment.id}`,
            type: 'LONG_SESSION',
            supervisorId: assignment.supervisorId,
            supervisorName: assignment.supervisor.lastName,
            supervisorFirstName: assignment.supervisor.firstName,
            siteId: assignment.siteId,
            siteName: assignment.site.name,
            severity: sessionDurationHours > 12 ? 'HIGH' : 'MEDIUM',
            message: `Session en cours depuis ${Math.floor(sessionDurationHours)}h`,
            createdAt: latestRecord.timestampLocal.toISOString(),
            actionRequired: true,
          });
        }
      }

      if (departureRecord && !report) {
        const dueAt = new Date(departureRecord.timestampLocal.getTime() + 2 * 60 * 60 * 1000);

        if (now > dueAt) {
          assignmentAlerts.push({
            id: `missing-report-${assignment.id}`,
            type: 'MISSING_REPORT',
            supervisorId: assignment.supervisorId,
            supervisorName: assignment.supervisor.lastName,
            supervisorFirstName: assignment.supervisor.firstName,
            siteId: assignment.siteId,
            siteName: assignment.site.name,
            severity: 'MEDIUM',
            message: 'Rapport en attente depuis plus de 2h',
            createdAt: departureRecord.timestampLocal.toISOString(),
            actionRequired: true,
          });
        }
      }

      alerts.push(...assignmentAlerts);

      return {
        id: assignment.id,
        supervisorId: assignment.supervisorId,
        supervisorName: assignment.supervisor.lastName,
        supervisorFirstName: assignment.supervisor.firstName,
        siteId: assignment.siteId,
        siteName: assignment.site.name,
        siteAddress: assignment.site.address,
        progressPercentage,
        targetProgress: assignment.targetProgress,
        objectiveText: assignment.objectiveText,
        objectiveStatus,
        actualProgress,
        progressDelta,
        isClockedIn,
        hasAlert: assignmentAlerts.length > 0,
        ...(assignmentAlerts[0] ? { alertType: assignmentAlerts[0].type } : {}),
      };
    });

    const generalSupervisorRecords = records.filter((record) => record.userId === user.id);
    const latestGeneralSupervisorRecord = generalSupervisorRecords.at(-1);
    const hasActiveSession = Boolean(
      latestGeneralSupervisorRecord &&
        latestGeneralSupervisorRecord.type !== ClockInType.DEPARTURE &&
        latestGeneralSupervisorRecord.type !== ClockInType.PAUSE_START,
    );

    const sessionData =
      hasActiveSession && latestGeneralSupervisorRecord
        ? {
            siteId: latestGeneralSupervisorRecord.siteId,
            siteName: latestGeneralSupervisorRecord.site.name,
            arrivalAt: latestGeneralSupervisorRecord.timestampLocal.toISOString(),
            durationSeconds: Math.floor(
              (now.getTime() - latestGeneralSupervisorRecord.timestampLocal.getTime()) / 1000,
            ),
            isPaused: latestGeneralSupervisorRecord.type === ClockInType.PAUSE_START,
          }
        : null;
    const objectiveCounts = todayAssignments.reduce(
      (counts, assignment) => {
        counts[assignment.objectiveStatus] += 1;
        return counts;
      },
      { NOT_STARTED: 0, PARTIAL: 0, ACHIEVED: 0, BLOCKED: 0 },
    );

    const dashboard: GeneralSupervisorDashboardResponse = {
      kpis: {
        deployedSupervisors: supervisorIds.length,
        totalSupervisors: supervisorIds.length,
        activeSupervisorsNow: todayAssignments.filter((assignment) => assignment.isClockedIn).length,
        reportsReceived: todayReports.length,
        reportsExpected: assignments.length,
        alertCount: alerts.length,
        objectivesAchieved: objectiveCounts.ACHIEVED,
        objectivesPartial: objectiveCounts.PARTIAL,
        objectivesBlocked: objectiveCounts.BLOCKED,
        objectivesNotStarted: objectiveCounts.NOT_STARTED,
      },
      todayAssignments,
      priorityAlerts: alerts.sort((a, b) => {
        const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        return severityDiff !== 0
          ? severityDiff
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }),
      hasActiveSession,
      ...(sessionData ? { sessionData } : {}),
    };

    return Response.json(dashboard);
  } catch (error) {
    console.error('General supervisor dashboard error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du dashboard' },
      { status: 500 },
    );
  }
});
