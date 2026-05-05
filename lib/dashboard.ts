import {
  ClockInStatus,
  ClockInType,
  ProjectStatus,
  ReportValidationStatus,
  Role,
  TeamMemberStatus,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import { createInternalPhotoUrl } from '@/lib/photos';
import { getDirectionAlerts, getDirectionKpis, getDirectionProjectsConsolidated } from '@/lib/direction';
import { listAdminDeletionLogs } from '@/lib/photos';
import { getRhExportHistory, getMonthlyRhPresences } from '@/lib/rh';
import type {
  DashboardAdminRoleCount,
  DashboardAlertItem,
  DashboardApiErrorCode,
  DashboardResponse,
  DashboardStat,
  DashboardSupportedRole,
} from '@/types/dashboard';

const DASHBOARD_ROLES: readonly DashboardSupportedRole[] = [
  Role.PROJECT_MANAGER,
  Role.HR,
  Role.DIRECTION,
  Role.ADMIN,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
] as const;

const FIELD_ROLES: readonly Role[] = [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR];

type AuthLikeUser = {
  id: string;
  role: Role;
};

type RecentReportRow = {
  id: string;
  siteId: string;
  siteName: string;
  authorName: string;
  submittedAt: string;
  excerpt: string;
};

type RecentPhotoRow = {
  id: string;
  siteId: string;
  siteName: string;
  filename: string;
  createdAt: string;
  url: string | null;
};

export function canAccessDashboard(role: Role): role is DashboardSupportedRole {
  return DASHBOARD_ROLES.includes(role as DashboardSupportedRole);
}

export function jsonDashboardError(
  code: DashboardApiErrorCode,
  status: number,
  message: string,
) {
  return Response.json(
    {
      code,
      message,
    },
    { status },
  );
}

export async function getDashboardData(prisma: PrismaClient, user: AuthLikeUser): Promise<DashboardResponse> {
  switch (user.role) {
    case Role.PROJECT_MANAGER:
      return getProjectManagerDashboard(prisma, user.id);
    case Role.HR:
      return getHrDashboard(prisma);
    case Role.DIRECTION:
      return getDirectionDashboard(prisma);
    case Role.ADMIN:
      return getAdminDashboard(prisma);
    case Role.COORDINATOR:
      return getCoordinatorDashboard(prisma, user.id);
    case Role.GENERAL_SUPERVISOR:
      return getGeneralSupervisorDashboard(prisma, user.id);
    default:
      throw new Error(`Unsupported dashboard role: ${user.role}`);
  }
}

async function getProjectManagerDashboard(prisma: PrismaClient, userId: string): Promise<DashboardResponse> {
  const now = new Date();
  const todayRange = dayRange(now);
  const weekRange = weekRangeFromDate(now);

  const projects = await prisma.project.findMany({
    where: {
      projectManagerId: userId,
    },
    select: {
      id: true,
      status: true,
    },
  });
  const projectIds = projects.map((project) => project.id);

  const [
    presentResourcesToday,
    activeSitesThisWeek,
    photos,
    reports,
    alerts,
  ] = await Promise.all([
    prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        type: ClockInType.ARRIVAL,
        timestampLocal: {
          gte: todayRange.from,
          lte: todayRange.to,
        },
        site: {
          projectId: {
            in: projectIds,
          },
        },
      },
      distinct: ['userId'],
      select: {
        userId: true,
      },
    }),
    prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        timestampLocal: {
          gte: weekRange.from,
          lte: weekRange.to,
        },
        site: {
          projectId: {
            in: projectIds,
          },
        },
      },
      distinct: ['siteId'],
      select: {
        siteId: true,
      },
    }),
    prisma.photo.findMany({
      where: {
        isDeleted: false,
        site: {
          projectId: {
            in: projectIds,
          },
        },
      },
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      take: 4,
      select: {
        id: true,
        siteId: true,
        filename: true,
        storageKey: true,
        timestampLocal: true,
        site: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.report.findMany({
      where: {
        site: {
          projectId: {
            in: projectIds,
          },
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        content: true,
        submittedAt: true,
        siteId: true,
        site: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
    getDirectionAlerts(prisma),
  ]);

  const activeProjectCount = projects.filter((project) => project.status === ProjectStatus.IN_PROGRESS).length;
  const latestPhotos = photos.map(serializeDashboardPhoto);
  const latestReports = reports.map(serializeDashboardReport);
  const relevantAlerts = alerts.sitesWithoutPresence
    .filter((alert) => projectIds.includes(alert.projectId))
    .slice(0, 5)
    .map<DashboardAlertItem>((alert) => ({
      id: alert.siteId,
      level: 'error',
      title: alert.siteName,
      description: 'Aucune presence enregistree depuis plus de 2 jours.',
      badge: 'Urgent',
    }));

  return {
    role: Role.PROJECT_MANAGER,
    generatedAt: now.toISOString(),
    stats: [
      createStat('projects', 'Projets actifs', activeProjectCount, 'primary'),
      createStat('users', "Ressources presentes aujourd'hui", presentResourcesToday.length, 'success'),
      createStat('sites', 'Sites actifs cette semaine', activeSitesThisWeek.length, 'warning'),
      createStat('photos', 'Dernieres photos', latestPhotos.length, 'neutral'),
    ],
    latestPhotos,
    latestReports,
    alerts: relevantAlerts,
  };
}

async function getHrDashboard(prisma: PrismaClient): Promise<DashboardResponse> {
  const now = new Date();
  const period = currentMonthPeriod(now);
  const presences = await getMonthlyRhPresences(prisma, {
    month: period.month,
    year: period.year,
    userId: null,
    projectId: null,
    siteIds: [],
    search: null,
  });
  const history = await getRhExportHistory(prisma);
  const alerts = await getDirectionAlerts(prisma);

  const totalHours = round2(
    presences.items.reduce((sum, item) => sum + item.totalHours, 0),
  );
  const topResources = [...presences.items]
    .sort((left, right) => right.totalHours - left.totalHours || left.lastName.localeCompare(right.lastName))
    .slice(0, 5);
  const absentAlerts = alerts.absentResources
    .filter((item) => item.workingDaysAbsent > 5)
    .slice(0, 5)
    .map<DashboardAlertItem>((item) => ({
      id: `${item.siteId}:${item.userId}`,
      level: 'warning',
      title: `${item.firstName} ${item.lastName}`,
      description: `Aucun pointage depuis ${item.workingDaysAbsent} jours ouvres sur ${item.siteName}.`,
      badge: `${item.workingDaysAbsent} j`,
    }));

  return {
    role: Role.HR,
    generatedAt: now.toISOString(),
    stats: [
      createStat('clock', 'Heures mois courant', formatHours(totalHours), 'primary'),
      createStat('users', 'Ressources actives ce mois', presences.items.length, 'success'),
      createStat('exports', 'Derniers exports', history.items.slice(0, 5).length, 'neutral'),
      createStat('alerts', 'Alertes > 5 jours', absentAlerts.length, 'danger'),
    ],
    topResources,
    latestExports: history.items.slice(0, 5),
    alerts: absentAlerts,
  };
}

async function getDirectionDashboard(prisma: PrismaClient): Promise<DashboardResponse> {
  const now = new Date();
  const period = currentMonthPeriod(now);
  const [kpis, consolidated, alerts] = await Promise.all([
    getDirectionKpis(prisma, period),
    getDirectionProjectsConsolidated(prisma, {
      ...period,
      status: null,
      projectManager: null,
    }),
    getDirectionAlerts(prisma),
  ]);

  return {
    role: Role.DIRECTION,
    generatedAt: now.toISOString(),
    stats: [
      createStat('projects', 'Projets en cours', kpis.projects.inProgress, 'primary'),
      createStat('planning', 'Projets en pause', kpis.projects.onHold, 'warning'),
      createStat('shield', 'Projets termines', kpis.projects.completed, 'success'),
      createStat('users', 'Presences vs mois precedent', kpis.presences.currentMonth, 'neutral', kpis.presences.deltaPercent, 'vs M-1'),
      createStat('photos', 'Photos vs mois precedent', kpis.photos.currentMonth, 'neutral', kpis.photos.deltaPercent, 'vs M-1'),
      createStat(
        'alerts',
        'Alertes consolidees',
        alerts.sitesWithoutPresence.length + alerts.incompleteSessions.length + alerts.absentResources.length,
        'danger',
      ),
    ],
    kpis,
    consolidatedProjects: consolidated.items,
    alerts,
  };
}

async function getAdminDashboard(prisma: PrismaClient): Promise<DashboardResponse> {
  const now = new Date();
  const [users, latestDeletions, mustChangePasswordCount, recentFailedLogins, revokedTokens] = await Promise.all([
    prisma.user.findMany({
      select: {
        role: true,
        isActive: true,
      },
    }),
    listAdminDeletionLogs(prisma, {
      page: 1,
      deletedBy: null,
      from: null,
      to: null,
    }),
    prisma.user.count({
      where: {
        mustChangePassword: true,
        isActive: true,
      },
    }),
    prisma.loginAttempt.count({
      where: {
        success: false,
        attemptedAt: {
          gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.refreshToken.count({
      where: {
        revokedAt: {
          not: null,
          gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  const usersByRole = buildAdminRoleCounts(users);
  const alerts: DashboardAlertItem[] = [];

  if (mustChangePasswordCount > 0) {
    alerts.push({
      id: 'must-change-password',
      level: 'warning',
      title: 'Mot de passe a renouveler',
      description: `${mustChangePasswordCount} compte(s) actif(s) doivent changer leur mot de passe.`,
      badge: String(mustChangePasswordCount),
    });
  }

  if (recentFailedLogins > 0) {
    alerts.push({
      id: 'failed-logins',
      level: 'error',
      title: 'Tentatives de connexion invalides',
      description: `${recentFailedLogins} tentative(s) echees ont ete detectees sur les dernieres 24h.`,
      badge: '24h',
    });
  }

  if (revokedTokens > 0) {
    alerts.push({
      id: 'revoked-tokens',
      level: 'info',
      title: 'Sessions revoquees',
      description: `${revokedTokens} session(s) ont ete revoquees au cours des dernieres 24h.`,
      badge: 'Audit',
    });
  }

  return {
    role: Role.ADMIN,
    generatedAt: now.toISOString(),
    stats: [
      createStat('users', 'Utilisateurs actifs', users.filter((user) => user.isActive).length, 'success'),
      createStat('shield', 'Utilisateurs total', users.length, 'neutral'),
      createStat('photos', 'Suppressions photo recentes', latestDeletions.items.slice(0, 5).length, 'warning'),
      createStat('alerts', 'Alertes systeme', alerts.length, 'danger'),
    ],
    usersByRole,
    latestDeletions: latestDeletions.items.slice(0, 5),
    alerts,
  };
}

async function getCoordinatorDashboard(prisma: PrismaClient, userId: string): Promise<DashboardResponse> {
  const now = new Date();
  const today = dayRange(now);
  const siteScope = await getOperationalSiteIds(prisma, userId);
  const [
    reportsReceivedToday,
    reportsValidatedForClient,
    fieldSession,
    supervisors,
    recentReports,
    supervisorTokens,
  ] =
    await Promise.all([
      countReportsInRange(prisma, siteScope, today.from, today.to),
      prisma.report.count({
        where: {
          siteId: {
            in: siteScope,
          },
          validationStatus: ReportValidationStatus.VALIDATED_FOR_CLIENT,
          validatedForClientAt: {
            gte: today.from,
            lte: today.to,
          },
        },
      }),
      findOpenFieldSession(prisma, userId, siteScope, now),
      getScopedSupervisors(prisma, siteScope),
      prisma.report.findMany({
        where: {
          siteId: {
            in: siteScope,
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: 5,
        select: {
          id: true,
          content: true,
          submittedAt: true,
          siteId: true,
          site: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      prisma.pushToken.findMany({
        where: {
          user: {
            role: Role.SUPERVISOR,
            isActive: true,
          },
        },
        select: {
          userId: true,
        },
      }),
    ]);

  const supervisorIds = supervisors.map((supervisor) => supervisor.id);
  const [supervisorRecords, missingReportSessions] = await Promise.all([
    prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        userId: {
          in: supervisorIds,
        },
        siteId: {
          in: siteScope,
        },
      },
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        siteId: true,
        userId: true,
        type: true,
        timestampLocal: true,
        site: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        report: {
          select: {
            id: true,
          },
        },
      },
    }),
    prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        type: ClockInType.DEPARTURE,
        timestampLocal: {
          gte: today.from,
          lte: today.to,
        },
        siteId: {
          in: siteScope,
        },
        userId: {
          in: supervisorIds,
        },
        report: null,
      },
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        siteId: true,
        userId: true,
        timestampLocal: true,
        site: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
  ]);

  const activeSupervisorIds = new Set<string>();
  const incompleteSessionAlerts: DashboardAlertItem[] = [];
  const lastRecordBySupervisor = new Map<string, (typeof supervisorRecords)[number]>();

  for (const supervisor of supervisors) {
    const records = supervisorRecords.filter((record) => record.userId === supervisor.id);
    const latestRecord = records[0];

    if (latestRecord) {
      lastRecordBySupervisor.set(supervisor.id, latestRecord);
    }

    const latestSessionRecord = records.find(
      (record) => record.type === ClockInType.ARRIVAL || record.type === ClockInType.DEPARTURE,
    );

    if (latestSessionRecord?.type === ClockInType.ARRIVAL) {
      activeSupervisorIds.add(supervisor.id);
      const hoursOpen = (now.getTime() - latestSessionRecord.timestampLocal.getTime()) / (60 * 60 * 1000);

      if (hoursOpen > 12) {
        incompleteSessionAlerts.push({
          id: `incomplete:${latestSessionRecord.userId}:${latestSessionRecord.siteId}`,
          level: 'warning',
          title: `${latestSessionRecord.user.firstName} ${latestSessionRecord.user.lastName}`,
          description: `Session ouverte depuis ${Math.floor(hoursOpen)} h sur ${latestSessionRecord.site.name}.`,
          badge: '> 12h',
        });
      }
    }
  }

  const absentThreshold = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const absentAlerts = supervisors
    .filter((supervisor) => {
      const latestRecord = lastRecordBySupervisor.get(supervisor.id);
      return !latestRecord || latestRecord.timestampLocal.getTime() < absentThreshold.getTime();
    })
    .slice(0, 5)
    .map<DashboardAlertItem>((supervisor) => ({
      id: `absent:${supervisor.id}`,
      level: 'error',
      title: `${supervisor.firstName} ${supervisor.lastName}`,
      description: 'Aucun pointage valide depuis plus de 2 jours dans le perimetre coordinateur.',
      badge: '> 2j',
    }));

  const tokenCounts = buildTokenCounts(supervisorTokens);
  const supervisorsWithoutReport = missingReportSessions.map((record) => ({
    id: record.id,
    siteId: record.siteId,
    siteName: record.site.name,
    supervisorId: record.userId,
    supervisorName: `${record.user.firstName} ${record.user.lastName}`,
    endedAt: record.timestampLocal.toISOString(),
    pushTokenCount: tokenCounts.get(record.userId) ?? 0,
  }));

  const pendingReports = await prisma.report.findMany({
    where: {
      siteId: {
        in: siteScope,
      },
      validationStatus: ReportValidationStatus.SUBMITTED,
    },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    take: 10,
    select: {
      id: true,
      content: true,
      submittedAt: true,
      siteId: true,
      site: {
        select: {
          name: true,
        },
      },
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  const alerts: DashboardAlertItem[] = [
    ...absentAlerts,
    ...incompleteSessionAlerts.slice(0, 5),
  ];

  return {
    role: Role.COORDINATOR,
    generatedAt: now.toISOString(),
    stats: [
      createStat('users', 'Superviseurs actifs', activeSupervisorIds.size, 'success'),
      createStat('reports', "Rapports recus aujourd'hui", reportsReceivedToday, 'primary'),
      createStat('alerts', 'Rapports en attente', supervisorsWithoutReport.length, 'warning'),
      createStat('shield', 'Valides client', reportsValidatedForClient, 'neutral'),
    ],
    fieldSession,
    kpisToday: {
      activeSupervisorsNow: activeSupervisorIds.size,
      reportsReceivedToday,
      reportsMissing: supervisorsWithoutReport.length,
      reportsValidatedForClient,
    },
    pendingValidationReports: pendingReports.map((report) => ({
      id: report.id,
      siteId: report.siteId,
      siteName: report.site.name,
      supervisorId: report.user.id,
      supervisorName: `${report.user.firstName} ${report.user.lastName}`,
      submittedAt: report.submittedAt.toISOString(),
      progressPercent: calculateReportProgress(report.content),
      excerpt: report.content.length > 120 ? `${report.content.slice(0, 117)}...` : report.content,
    })),
    supervisorsWithoutReport,
    recentReports: recentReports.map(serializeDashboardReport),
    alerts,
  };
}

async function getGeneralSupervisorDashboard(prisma: PrismaClient, userId: string): Promise<DashboardResponse> {
  const now = new Date();
  const siteScope = await getOperationalSiteIds(prisma, userId);
  const [activeTeams, assignedFieldUsers, activeFieldUsers, recentReports, directionAlerts] =
    await Promise.all([
      prisma.team.count({
        where: {
          status: TeamStatus.ACTIVE,
          siteId: {
            in: siteScope,
          },
        },
      }),
      prisma.teamMember.findMany({
        where: {
          status: TeamMemberStatus.ACTIVE,
          team: {
            status: TeamStatus.ACTIVE,
            siteId: {
              in: siteScope,
            },
          },
          user: {
            role: {
              in: [...FIELD_ROLES],
            },
            isActive: true,
          },
        },
        distinct: ['userId'],
        select: {
          userId: true,
        },
      }),
      prisma.user.findMany({
        where: {
          isActive: true,
          role: {
            in: [...FIELD_ROLES],
          },
          OR: [
            {
              teamMemberships: {
                some: {
                  status: TeamMemberStatus.ACTIVE,
                  team: {
                    status: TeamStatus.ACTIVE,
                    siteId: {
                      in: siteScope,
                    },
                  },
                },
              },
            },
            {
              clockInRecords: {
                some: {
                  siteId: {
                    in: siteScope,
                  },
                },
              },
            },
            {
              reports: {
                some: {
                  siteId: {
                    in: siteScope,
                  },
                },
              },
            },
          ],
        },
        select: {
          id: true,
        },
      }),
      prisma.report.findMany({
        where: {
          siteId: {
            in: siteScope,
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: 5,
        select: {
          id: true,
          content: true,
          submittedAt: true,
          siteId: true,
          site: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      getDirectionAlerts(prisma),
    ]);

  const assignedFieldIds = new Set(assignedFieldUsers.map((item) => item.userId));
  const unassignedFieldUsers = activeFieldUsers.filter((user) => !assignedFieldIds.has(user.id)).length;
  const relevantSiteAlerts = directionAlerts.sitesWithoutPresence.filter((item) => siteScope.includes(item.siteId));
  const relevantIncompleteSessions = directionAlerts.incompleteSessions.filter((item) => siteScope.includes(item.siteId));

  const alerts: DashboardAlertItem[] = [
    ...relevantSiteAlerts.slice(0, 3).map<DashboardAlertItem>((item) => ({
      id: `site:${item.siteId}`,
      level: 'error',
      title: item.siteName,
      description: 'Aucune presence detectee depuis plus de 2 jours.',
      badge: 'Presence',
    })),
    ...relevantIncompleteSessions.slice(0, 2).map<DashboardAlertItem>((item) => ({
      id: `session:${item.userId}:${item.siteId}`,
      level: 'warning',
      title: `${item.firstName} ${item.lastName}`,
      description: `Session incomplete ouverte depuis ${item.hoursOpen} heures sur ${item.siteName}.`,
      badge: 'Session',
    })),
  ];

  if (unassignedFieldUsers > 0) {
    alerts.push({
      id: 'unassigned-resources',
      level: 'info',
      title: 'Ressources a affecter',
      description: `${unassignedFieldUsers} ressource(s) terrain actives ne sont rattachees a aucune equipe en scope.`,
      badge: 'Planning',
    });
  }

  return {
    role: Role.GENERAL_SUPERVISOR,
    generatedAt: now.toISOString(),
    stats: [
      createStat('planning', 'Sites en coordination', siteScope.length, 'primary'),
      createStat('users', 'Equipes actives', activeTeams, 'success'),
      createStat('users', 'Ressources affectees', assignedFieldIds.size, 'neutral'),
      createStat('alerts', 'Ressources non affectees', unassignedFieldUsers, 'warning'),
    ],
    recentReports: recentReports.map(serializeDashboardReport),
    alerts,
  };
}

function createStat(
  icon: DashboardStat['icon'],
  label: string,
  value: number | string,
  tone: DashboardStat['tone'],
  delta?: number | null,
  deltaLabel?: string,
): DashboardStat {
  const stat: DashboardStat = {
    icon,
    label,
    value,
  };

  if (tone !== undefined) {
    stat.tone = tone;
  }

  if (delta !== undefined) {
    stat.delta = delta;
  }

  if (deltaLabel !== undefined) {
    stat.deltaLabel = deltaLabel;
  }

  return stat;
}

function serializeDashboardPhoto(photo: {
  id: string;
  siteId: string;
  filename: string;
  storageKey: string;
  timestampLocal: Date;
  site: {
    name: string;
  };
}): RecentPhotoRow {
  return {
    id: photo.id,
    siteId: photo.siteId,
    siteName: photo.site.name,
    filename: photo.filename,
    createdAt: photo.timestampLocal.toISOString(),
    url: createInternalPhotoUrl(photo.id),
  };
}

function serializeDashboardReport(report: {
  id: string;
  content: string;
  submittedAt: Date;
  siteId: string;
  site: {
    name: string;
  };
  user: {
    firstName: string;
    lastName: string;
  };
}): RecentReportRow {
  return {
    id: report.id,
    siteId: report.siteId,
    siteName: report.site.name,
    authorName: `${report.user.firstName} ${report.user.lastName}`,
    submittedAt: report.submittedAt.toISOString(),
    excerpt: report.content.length > 120 ? `${report.content.slice(0, 117)}...` : report.content,
  };
}

export async function getOperationalSiteIds(prisma: PrismaClient, userId: string) {
  const sites = await prisma.site.findMany({
    where: {
      OR: [
        {
          teams: {
            some: {
              status: TeamStatus.ACTIVE,
              members: {
                some: {
                  userId,
                  status: TeamMemberStatus.ACTIVE,
                },
              },
            },
          },
        },
        {
          clockInRecords: {
            some: {
              userId,
            },
          },
        },
        {
          reports: {
            some: {
              userId,
            },
          },
        },
        {
          photos: {
            some: {
              uploadedById: userId,
            },
          },
        },
      ],
    },
    select: {
      id: true,
    },
  });

  return sites.map((site) => site.id);
}

async function findOpenFieldSession(prisma: PrismaClient, userId: string, siteIds: string[], now: Date) {
  if (siteIds.length === 0) {
    return null;
  }

  const latestSessionRecord = await prisma.clockInRecord.findFirst({
    where: {
      userId,
      siteId: {
        in: siteIds,
      },
      status: ClockInStatus.VALID,
      type: {
        in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE],
      },
    },
    orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
    select: {
      siteId: true,
      type: true,
      timestampLocal: true,
      site: {
        select: {
          name: true,
        },
      },
    },
  });

  if (latestSessionRecord?.type !== ClockInType.ARRIVAL) {
    return null;
  }

  return {
    siteId: latestSessionRecord.siteId,
    siteName: latestSessionRecord.site.name,
    arrivalAt: latestSessionRecord.timestampLocal.toISOString(),
    durationSeconds: Math.max(0, Math.floor((now.getTime() - latestSessionRecord.timestampLocal.getTime()) / 1000)),
  };
}

async function getScopedSupervisors(prisma: PrismaClient, siteIds: string[]) {
  if (siteIds.length === 0) {
    return [];
  }

  return prisma.user.findMany({
    where: {
      role: Role.SUPERVISOR,
      isActive: true,
      OR: [
        {
          teamMemberships: {
            some: {
              status: TeamMemberStatus.ACTIVE,
              team: {
                status: TeamStatus.ACTIVE,
                siteId: {
                  in: siteIds,
                },
              },
            },
          },
        },
        {
          clockInRecords: {
            some: {
              siteId: {
                in: siteIds,
              },
            },
          },
        },
        {
          reports: {
            some: {
              siteId: {
                in: siteIds,
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
}

function buildTokenCounts(tokens: { userId: string }[]) {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token.userId, (counts.get(token.userId) ?? 0) + 1);
  }

  return counts;
}

function calculateReportProgress(content: string) {
  const trimmed = content.trim();

  if (trimmed.length >= 600) {
    return 100;
  }

  if (trimmed.length >= 300) {
    return 75;
  }

  if (trimmed.length >= 120) {
    return 50;
  }

  return 25;
}

async function countReportsInRange(prisma: PrismaClient, siteIds: string[], from: Date, to: Date) {
  if (siteIds.length === 0) {
    return 0;
  }

  return prisma.report.count({
    where: {
      siteId: {
        in: siteIds,
      },
      submittedAt: {
        gte: from,
        lte: to,
      },
    },
  });
}

function buildAdminRoleCounts(users: { role: Role; isActive: boolean }[]) {
  const counts = new Map<Role, DashboardAdminRoleCount>();

  for (const role of Object.values(Role)) {
    counts.set(role, {
      role,
      active: 0,
      total: 0,
    });
  }

  for (const user of users) {
    const current = counts.get(user.role);

    if (!current) {
      continue;
    }

    current.total += 1;
    if (user.isActive) {
      current.active += 1;
    }
  }

  return [...counts.values()];
}

function currentMonthPeriod(now: Date) {
  return {
    month: now.getUTCMonth() + 1,
    year: now.getUTCFullYear(),
  };
}

function dayRange(date: Date) {
  return {
    from: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)),
    to: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)),
  };
}

function weekRangeFromDate(date: Date) {
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  start.setUTCDate(start.getUTCDate() - diff);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);

  return {
    from: start,
    to: end,
  };
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function formatHours(value: number) {
  return `${round2(value)} h`;
}
