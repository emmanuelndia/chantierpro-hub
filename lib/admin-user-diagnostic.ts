import {
  ClockInStatus,
  ClockInType,
  FreeMissionStatus,
  GeneralSupervisorSiteScopeStatus,
  NegotiationAssignmentStatus,
  OfficeClockInLocation,
  PlanningWorkLocationType,
  Role,
  SiteStatus,
  type PrismaClient,
} from '@prisma/client';
import { canUploadPhotos } from '@/lib/photos';
import { CLOCK_IN_FIELD_USER_ROLES, FIELD_USER_ROLES } from '@/lib/field-roles';
import type {
  AdminUserDiagnosticAssignment,
  AdminUserDiagnosticItem,
  AdminUserDiagnosticResponse,
  AdminUserDiagnosticSiteOption,
} from '@/types/admin-user-diagnostic';

const OFFICE_ONLY_CLOCK_IN_ROLES: readonly Role[] = [
  Role.OFFICE_STAFF,
  Role.HR,
  Role.DIRECTION,
  Role.ADMIN,
  Role.AUDITOR,
];

const SITE_CLOCK_IN_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.RESOURCE,
  Role.EXTERNAL_RESOURCE,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.BE_RESOURCE,
  Role.BE_MANAGER,
  Role.NEGOTIATION_RESOURCE,
  Role.NEGOTIATION_MANAGER,
  Role.FLEET_RESOURCE,
  Role.PROJECT_MANAGER,
];

export async function getAdminUserDiagnostic(
  prisma: PrismaClient,
  payload: {
    adminUserId: string;
    targetUserId: string;
    dateLabel: string | null;
  },
): Promise<AdminUserDiagnosticResponse | null> {
  const date = parseDiagnosticDate(payload.dateLabel);
  const dateLabel = formatDateLabel(date);
  const user = await prisma.user.findUnique({
    where: { id: payload.targetUserId },
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      email: true,
      matricule: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
    },
  });

  if (!user) return null;

  const [planningAssignments, freeMissions, negotiationAssignments, clockInRecords, openSession, photoSites, scopeSummary] = await Promise.all([
    prisma.planningAssignment.findMany({
      where: {
        supervisorId: user.id,
        date,
        deletedAt: null,
      },
      orderBy: [{ site: { name: 'asc' } }, { id: 'asc' }],
      select: {
        id: true,
        action: true,
        status: true,
        workLocationType: true,
        site: {
          select: {
            id: true,
            name: true,
            status: true,
            project: { select: { id: true, name: true, status: true } },
          },
        },
      },
    }),
    prisma.freeMission.findMany({
      where: {
        assigneeId: user.id,
        date,
        deletedAt: null,
        status: { not: FreeMissionStatus.CANCELLED },
      },
      orderBy: [{ project: { name: 'asc' } }, { id: 'asc' }],
      select: {
        id: true,
        action: true,
        plannedZone: true,
        status: true,
        project: { select: { id: true, name: true, status: true } },
      },
    }),
    prisma.negotiationAssignment.findMany({
      where: {
        assigneeId: user.id,
        date,
        deletedAt: null,
        status: { not: NegotiationAssignmentStatus.CANCELLED },
      },
      orderBy: [{ project: { name: 'asc' } }, { zone: { name: 'asc' } }, { id: 'asc' }],
      select: {
        id: true,
        plannedZone: true,
        instruction: true,
        status: true,
        project: { select: { id: true, name: true, status: true } },
        zone: { select: { id: true, name: true } },
      },
    }),
    prisma.clockInRecord.findMany({
      where: {
        userId: user.id,
        clockInDate: date,
        status: ClockInStatus.VALID,
      },
      orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        timestampLocal: true,
        siteId: true,
        freeMissionId: true,
        officeClockInLocation: true,
        officeLocation: { select: { name: true } },
        site: { select: { id: true, name: true, project: { select: { name: true } } } },
        freeMission: { select: { id: true, action: true, project: { select: { name: true } } } },
      },
    }),
    prisma.clockInRecord.findFirst({
      where: {
        userId: user.id,
        status: ClockInStatus.VALID,
        type: ClockInType.ARRIVAL,
        NOT: {
          id: {
            in: await findClosedArrivalIds(prisma, user.id),
          },
        },
      },
      orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        siteId: true,
        freeMissionId: true,
        officeClockInLocation: true,
        officeLocation: { select: { name: true } },
        site: { select: { name: true } },
        freeMission: { select: { action: true } },
        timestampLocal: true,
      },
    }),
    loadPhotoSites(prisma, user, date),
    loadScopeSummary(prisma, user),
  ]);

  const assignments = [
    ...planningAssignments.map((assignment): AdminUserDiagnosticAssignment => ({
      id: assignment.id,
      kind:
        assignment.workLocationType === PlanningWorkLocationType.OFFICE
          ? 'OFFICE'
          : assignment.workLocationType === PlanningWorkLocationType.FREE_MISSION
            ? 'ZONE'
            : 'SITE',
      label: assignment.action,
      projectName: assignment.site.project.name,
      siteName: assignment.site.name,
      zoneName: assignment.workLocationType === PlanningWorkLocationType.FREE_MISSION ? assignment.action : null,
      action: assignment.action,
      status: assignment.status,
      source: 'PLANNING',
    })),
    ...freeMissions.map((mission): AdminUserDiagnosticAssignment => ({
      id: mission.id,
      kind: 'ZONE',
      label: mission.plannedZone ?? mission.action,
      projectName: mission.project.name,
      siteName: null,
      zoneName: mission.plannedZone ?? mission.action,
      action: mission.action,
      status: mission.status,
      source: 'FREE_MISSION',
    })),
    ...negotiationAssignments.map((assignment): AdminUserDiagnosticAssignment => ({
      id: assignment.id,
      kind: 'NEGOTIATION',
      label: assignment.zone?.name ?? assignment.plannedZone ?? 'Zone nego',
      projectName: assignment.project.name,
      siteName: null,
      zoneName: assignment.zone?.name ?? assignment.plannedZone ?? 'Zone nego',
      action: assignment.instruction ?? `Negociation - ${assignment.zone?.name ?? assignment.plannedZone ?? 'Zone'}`,
      status: assignment.status,
      source: 'NEGOTIATION',
    })),
  ];

  const siteAssignments = assignments.filter((assignment) => assignment.kind === 'SITE');
  const zoneAssignments = assignments.filter((assignment) => assignment.kind === 'ZONE');
  const officeAssignments = assignments.filter((assignment) => assignment.kind === 'OFFICE');
  const negotiationAssignmentItems = assignments.filter((assignment) => assignment.kind === 'NEGOTIATION');
  const siteOptions = buildSiteOptions(planningAssignments, clockInRecords);
  const diagnostics = buildDiagnostics({
    user,
    dateLabel,
    assignments,
    siteOptions,
    zoneAssignments,
    photoSites,
    openSession,
  });
  const visibility = buildVisibility(user.role);
  const lastRecord = clockInRecords.at(-1) ?? null;

  console.info('admin_user_diagnostic_viewed', {
    adminUserId: payload.adminUserId,
    targetUserId: user.id,
    date: dateLabel,
    at: new Date().toISOString(),
  });

  return {
    date: dateLabel,
    user: {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      matricule: user.matricule,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      scopeSummary,
    },
    mobileVisibility: visibility,
    assignments: {
      all: assignments,
      site: siteAssignments,
      zone: zoneAssignments,
      office: officeAssignments,
      negotiation: negotiationAssignmentItems,
    },
    clockIn: {
      recordsCount: clockInRecords.length,
      hasOpenSession: Boolean(openSession),
      openSessionLabel: openSession ? formatOpenSessionLabel(openSession) : null,
      pauseActive: hasActivePause(clockInRecords),
      lastEventLabel: lastRecord ? `${formatClockInType(lastRecord.type)} - ${formatTime(lastRecord.timestampLocal)}` : null,
    },
    photo: {
      sites: photoSites,
    },
    offline: {
      preparedByMobileOnly: true,
      expectedCacheKeys: [
        'sites-today',
        'mobile-photo-sites',
        `mobile-planning-my-assignments-${dateLabel}`,
        'clock-in-today',
      ],
    },
    simulatedView: {
      office: {
        available: visibility.canUseOffice,
        reason: visibility.canUseOffice ? null : 'Ce role ne pointe pas au bureau dans le flux mobile.',
      },
      site: {
        available: visibility.canUseSite && siteOptions.length > 0,
        options: siteOptions,
        reason:
          siteOptions.length > 0
            ? null
            : visibility.canUseSite
              ? 'Aucun chantier planifie ou session chantier ouverte pour cette date.'
              : 'Ce role ne dispose pas du pointage chantier.',
      },
      zone: {
        available: visibility.canUseZone && (zoneAssignments.length > 0 || negotiationAssignmentItems.length > 0),
        options: [...zoneAssignments, ...negotiationAssignmentItems],
        reason:
          zoneAssignments.length + negotiationAssignmentItems.length > 0
            ? null
            : visibility.canUseZone
              ? 'Aucune tache zone planifiee pour cette date.'
              : 'Ce role ne dispose pas du pointage zone.',
      },
      professionalTravel: {
        available: visibility.canUseProfessionalTravel,
        reason: visibility.canUseProfessionalTravel ? null : 'Deplacement reserve aux roles bureau et chefs projet.',
      },
    },
    diagnostics,
  };
}

async function loadScopeSummary(prisma: PrismaClient, user: { id: string; role: Role }) {
  if (user.role === Role.PROJECT_MANAGER) {
    const [projects, sites] = await Promise.all([
      prisma.project.count({ where: { projectManagerId: user.id } }),
      prisma.site.count({ where: { project: { projectManagerId: user.id } } }),
    ]);

    return [`${projects} projet(s) gere(s)`, `${sites} chantier(s) rattache(s)`];
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    const [projectScopes, siteScopes] = await Promise.all([
      prisma.generalSupervisorProjectScope.count({
        where: { generalSupervisorId: user.id, status: GeneralSupervisorSiteScopeStatus.ACTIVE },
      }),
      prisma.generalSupervisorSiteScope.count({
        where: { generalSupervisorId: user.id, status: GeneralSupervisorSiteScopeStatus.ACTIVE },
      }),
    ]);

    return [`${projectScopes} perimetre(s) projet actif(s)`, `${siteScopes} perimetre(s) chantier actif(s)`];
  }

  if (user.role === Role.COORDINATOR) {
    const projectManagers = await prisma.coordinatorProjectManagerScope.count({
      where: { coordinatorId: user.id },
    });

    return [`${projectManagers} chef(s) projet suivi(s)`];
  }

  if (user.role === Role.FLEET_MANAGER) {
    const resources = await prisma.user.count({
      where: { role: Role.FLEET_RESOURCE, isActive: true },
    });

    return [`${resources} ressource(s) parc auto active(s)`];
  }

  return ['Perimetre direct selon role et taches assignees'];
}

async function findClosedArrivalIds(prisma: PrismaClient, userId: string) {
  const records = await prisma.clockInRecord.findMany({
    where: {
      userId,
      status: ClockInStatus.VALID,
      type: { in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE] },
    },
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, type: true, siteId: true, freeMissionId: true, officeClockInLocation: true, officeLocationId: true },
  });
  const openByContext = new Map<string, string>();
  const closed = new Set<string>();

  for (const record of records) {
    const key = [record.siteId, record.freeMissionId, record.officeLocationId, record.officeClockInLocation].join(':');
    if (record.type === ClockInType.ARRIVAL) {
      openByContext.set(key, record.id);
      continue;
    }
    const openId = openByContext.get(key);
    if (openId) {
      closed.add(openId);
      openByContext.delete(key);
    }
  }

  return [...closed];
}

async function loadPhotoSites(
  prisma: PrismaClient,
  user: { id: string; role: Role },
  date: Date,
): Promise<AdminUserDiagnosticSiteOption[]> {
  if (!canUploadPhotos(user.role)) return [];

  const sites = await prisma.site.findMany({
    where:
      user.role === Role.PROJECT_MANAGER
        ? { status: SiteStatus.ACTIVE, project: { projectManagerId: user.id } }
        : FIELD_USER_ROLES.includes(user.role)
          ? {
              OR: [
                {
                  status: SiteStatus.ACTIVE,
                  planningAssignments: {
                    some: {
                      supervisorId: user.id,
                      date,
                      deletedAt: null,
                      workLocationType: PlanningWorkLocationType.ON_SITE,
                    },
                  },
                },
                {
                  clockInRecords: {
                    some: {
                      userId: user.id,
                      clockInDate: date,
                      status: ClockInStatus.VALID,
                    },
                  },
                },
              ],
            }
          : { status: SiteStatus.ACTIVE },
    select: {
      id: true,
      name: true,
      project: { select: { name: true } },
      planningAssignments: {
        where: { supervisorId: user.id, date, deletedAt: null, workLocationType: PlanningWorkLocationType.ON_SITE },
        select: { id: true },
      },
      clockInRecords: {
        where: { userId: user.id, clockInDate: date, status: ClockInStatus.VALID },
        select: { id: true },
      },
    },
    orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
  });

  return sites.map((site) => ({
    id: site.id,
    name: site.name,
    projectName: site.project.name,
    source: site.planningAssignments.length > 0 ? 'PLANNING' : site.clockInRecords.length > 0 ? 'OPEN_SESSION' : 'ROLE_ACCESS',
  }));
}

function buildSiteOptions(
  planningAssignments: { id: string; workLocationType: PlanningWorkLocationType; site: { id: string; name: string; project: { name: string } } }[],
  clockInRecords: { siteId: string | null; site: { id: string; name: string; project: { name: string } } | null }[],
) {
  const options = new Map<string, AdminUserDiagnosticSiteOption>();

  for (const assignment of planningAssignments) {
    if (assignment.workLocationType !== PlanningWorkLocationType.ON_SITE) continue;
    options.set(assignment.site.id, {
      id: assignment.site.id,
      name: assignment.site.name,
      projectName: assignment.site.project.name,
      source: 'PLANNING',
    });
  }

  for (const record of clockInRecords) {
    if (!record.siteId || !record.site) continue;
    options.set(record.siteId, {
      id: record.site.id,
      name: record.site.name,
      projectName: record.site.project.name,
      source: options.get(record.siteId)?.source ?? 'OPEN_SESSION',
    });
  }

  return [...options.values()];
}

function buildVisibility(role: Role) {
  const canUseClockIn = CLOCK_IN_FIELD_USER_ROLES.includes(role) || OFFICE_ONLY_CLOCK_IN_ROLES.includes(role) || role === Role.PROJECT_MANAGER;
  const canUseOffice = canUseClockIn;
  const canUseSite = SITE_CLOCK_IN_ROLES.includes(role);
  const canUseZone = SITE_CLOCK_IN_ROLES.includes(role);
  const canUseProfessionalTravel = OFFICE_ONLY_CLOCK_IN_ROLES.includes(role) || role === Role.PROJECT_MANAGER;

  return {
    canUseClockIn,
    canUseOffice,
    canUseSite,
    canUseZone,
    canUseProfessionalTravel,
    canUploadPhotos: canUploadPhotos(role),
  };
}

function buildDiagnostics(payload: {
  user: { isActive: boolean; role: Role };
  dateLabel: string;
  assignments: AdminUserDiagnosticAssignment[];
  siteOptions: AdminUserDiagnosticSiteOption[];
  zoneAssignments: AdminUserDiagnosticAssignment[];
  photoSites: AdminUserDiagnosticSiteOption[];
  openSession: { siteId: string | null; freeMissionId: string | null; officeClockInLocation: OfficeClockInLocation | null } | null;
}) {
  const diagnostics: AdminUserDiagnosticItem[] = [];
  const visibility = buildVisibility(payload.user.role);

  if (!payload.user.isActive) {
    diagnostics.push({
      severity: 'error',
      code: 'USER_INACTIVE',
      message: 'Compte inactif.',
      hint: "L'utilisateur ne doit pas apparaitre dans les listes actives et ne peut pas travailler normalement.",
    });
  }

  if (!visibility.canUseClockIn) {
    diagnostics.push({
      severity: 'error',
      code: 'ROLE_CLOCK_IN_FORBIDDEN',
      message: 'Role non autorise au pointage mobile.',
      hint: 'Verifier le role du compte ou le flux mobile attendu.',
    });
  }

  if (payload.assignments.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'NO_ASSIGNMENT_FOR_DATE',
      message: `Aucune tache planifiee le ${payload.dateLabel}.`,
      hint: 'Verifier la date, la ressource assignee et les filtres planning.',
    });
  }

  if (visibility.canUseSite && payload.siteOptions.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'NO_SITE_VISIBLE',
      message: 'Aucun chantier visible au pointage.',
      hint: 'Il faut une tache chantier du jour ou une session chantier ouverte.',
    });
  }

  if (visibility.canUseZone && payload.zoneAssignments.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'NO_ZONE_VISIBLE',
      message: 'Aucune zone visible au pointage.',
      hint: 'Il faut une tache zone ou une mission zone assignee a cette ressource pour cette date.',
    });
  }

  if (visibility.canUploadPhotos && payload.photoSites.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'NO_PHOTO_SITE_VISIBLE',
      message: 'Aucun chantier disponible pour les photos.',
      hint: 'Verifier les taches chantier du jour ou le contexte de pointage ouvert.',
    });
  }

  if (payload.openSession) {
    diagnostics.push({
      severity: 'info',
      code: 'OPEN_SESSION',
      message: 'Une session est actuellement ouverte.',
      hint: 'Une session ouverte peut bloquer un nouveau pointage sur un autre contexte.',
    });
  }

  return diagnostics;
}

function hasActivePause(records: { type: ClockInType }[]) {
  let active = false;

  for (const record of records) {
    if (record.type === ClockInType.PAUSE_START) active = true;
    if (record.type === ClockInType.PAUSE_END || record.type === ClockInType.DEPARTURE) active = false;
  }

  return active;
}

function formatOpenSessionLabel(record: {
  site: { name: string } | null;
  freeMission: { action: string } | null;
  officeClockInLocation: OfficeClockInLocation | null;
  officeLocation: { name: string } | null;
}) {
  if (record.site) return `Chantier - ${record.site.name}`;
  if (record.freeMission) return `Zone - ${record.freeMission.action}`;
  if (record.officeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL) return 'Deplacement professionnel';
  return `Bureau - ${record.officeLocation?.name ?? 'Bureau'}`;
}

function formatClockInType(type: ClockInType) {
  if (type === ClockInType.ARRIVAL) return 'Entree';
  if (type === ClockInType.DEPARTURE) return 'Sortie';
  if (type === ClockInType.PAUSE_START) return 'Debut pause';
  if (type === ClockInType.PAUSE_END) return 'Reprise';
  return type;
}

function parseDiagnosticDate(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function formatDateLabel(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatTime(date: Date) {
  return date.toISOString().slice(11, 16);
}
