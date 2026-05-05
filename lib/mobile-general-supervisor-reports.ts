import {
  ClockInStatus,
  ClockInType,
  Role,
  TeamMemberStatus,
  TeamStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { createInternalPhotoUrl } from '@/lib/photos';
import type {
  GeneralSupervisorMissingReportItem,
  GeneralSupervisorReportDetailResponse,
  GeneralSupervisorReportItem,
  GeneralSupervisorReportsResponse,
  GeneralSupervisorReportStatusFilter,
} from '@/types/mobile-general-supervisor-reports';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type ReportsFilters = {
  date?: string | null;
  siteId?: string | null;
  supervisorId?: string | null;
  status?: GeneralSupervisorReportStatusFilter | null;
  q?: string | null;
};

type ReportRow = Prisma.ReportGetPayload<{
  select: typeof generalSupervisorReportSelect;
}>;

type DepartureRow = Prisma.ClockInRecordGetPayload<{
  select: typeof departureSelect;
}>;

export function canAccessGeneralSupervisorReports(role: Role) {
  return role === Role.GENERAL_SUPERVISOR;
}

export async function getGeneralSupervisorReports(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: ReportsFilters = {},
): Promise<GeneralSupervisorReportsResponse> {
  if (!canAccessGeneralSupervisorReports(user.role)) {
    return emptyReports(normalizeDate(filters.date));
  }

  const date = normalizeDate(filters.date);
  const { from, to } = dateRange(date);
  const siteWhere = operationalSiteWhere(user);
  const siteId = cleanString(filters.siteId);
  const supervisorId = cleanString(filters.supervisorId);
  const status = normalizeStatus(filters.status ?? null);
  const query = cleanString(filters.q);

  const scopedSiteWhere: Prisma.SiteWhereInput = {
    ...siteWhere,
    ...(siteId ? { id: siteId } : {}),
  };

  const reportWhere: Prisma.ReportWhereInput = {
    site: scopedSiteWhere,
    submittedAt: {
      gte: from,
      lte: to,
    },
    ...(supervisorId ? { userId: supervisorId } : {}),
    ...(status ? { validationStatus: status } : {}),
    ...(query
      ? {
          OR: [
            { content: { contains: query, mode: 'insensitive' } },
            { site: { name: { contains: query, mode: 'insensitive' } } },
            { user: { firstName: { contains: query, mode: 'insensitive' } } },
            { user: { lastName: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const departureWhere: Prisma.ClockInRecordWhereInput = {
    site: scopedSiteWhere,
    type: ClockInType.DEPARTURE,
    status: ClockInStatus.VALID,
    timestampLocal: {
      gte: from,
      lte: to,
    },
    ...(supervisorId ? { userId: supervisorId } : {}),
    user: {
      isActive: true,
      role: {
        in: [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR],
      },
    },
  };

  const [sites, supervisors, reports, departures] = await Promise.all([
    prisma.site.findMany({
      where: siteWhere,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          in: [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR],
        },
        teamMemberships: {
          some: {
            status: TeamMemberStatus.ACTIVE,
            team: {
              status: TeamStatus.ACTIVE,
              site: siteWhere,
            },
          },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    }),
    prisma.report.findMany({
      where: reportWhere,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 80,
      select: generalSupervisorReportSelect,
    }),
    prisma.clockInRecord.findMany({
      where: departureWhere,
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      take: 120,
      select: departureSelect,
    }),
  ]);

  const reportRecordIds = new Set(reports.map((report) => report.clockInRecordId));
  const missingReports = departures
    .filter((departure) => !departure.report && !reportRecordIds.has(departure.id))
    .map(serializeMissingReport);
  const reportItems = reports.map(serializeReportItem);
  const visibleSiteIds = new Set([...reportItems.map((report) => report.siteId), ...missingReports.map((item) => item.siteId)]);

  return {
    generatedAt: new Date().toISOString(),
    date,
    summary: {
      received: reportItems.length,
      expected: departures.length,
      missing: missingReports.length,
      sites: visibleSiteIds.size,
    },
    sites,
    supervisors,
    reports: reportItems,
    missingReports,
  };
}

export async function getGeneralSupervisorReportDetail(
  prisma: PrismaClient,
  user: AuthLikeUser,
  reportId: string,
): Promise<GeneralSupervisorReportDetailResponse | null> {
  if (!canAccessGeneralSupervisorReports(user.role)) {
    return null;
  }

  const report = await prisma.report.findFirst({
    where: {
      id: reportId,
      site: operationalSiteWhere(user),
    },
    select: generalSupervisorReportSelect,
  });

  if (!report) {
    return null;
  }

  const { from, to } = dateRange(report.submittedAt.toISOString().slice(0, 10));
  const photos = await prisma.photo.findMany({
    where: {
      siteId: report.siteId,
      uploadedById: report.userId,
      isDeleted: false,
      timestampLocal: {
        gte: from,
        lte: to,
      },
    },
    orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
    take: 8,
    select: {
      id: true,
      filename: true,
      timestampLocal: true,
    },
  });

  return {
    generatedAt: new Date().toISOString(),
    report: {
      ...serializeReportItem(report),
      content: report.content,
      session: {
        id: report.clockInRecord.id,
        type: report.clockInRecord.type,
        date: report.clockInRecord.clockInDate.toISOString().slice(0, 10),
        time: report.clockInRecord.clockInTime.toISOString().slice(11, 19),
        comment: report.clockInRecord.comment,
        distanceToSite: report.clockInRecord.distanceToSite.toNumber(),
      },
      validatedForClientAt: report.validatedForClientAt?.toISOString() ?? null,
      validatedForClientByName: report.validatedForClientBy
        ? `${report.validatedForClientBy.firstName} ${report.validatedForClientBy.lastName}`
        : null,
    },
    photos: photos.map((photo) => ({
      id: photo.id,
      filename: photo.filename,
      url: createInternalPhotoUrl(photo.id),
      takenAt: photo.timestampLocal.toISOString(),
    })),
  };
}

function operationalSiteWhere(user: AuthLikeUser): Prisma.SiteWhereInput {
  return {
    teams: {
      some: {
        status: TeamStatus.ACTIVE,
        members: {
          some: {
            userId: user.id,
            status: TeamMemberStatus.ACTIVE,
          },
        },
      },
    },
  };
}

const generalSupervisorReportSelect = {
  id: true,
  siteId: true,
  userId: true,
  clockInRecordId: true,
  content: true,
  submittedAt: true,
  validationStatus: true,
  validatedForClientAt: true,
  validatedForClientBy: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
  site: {
    select: {
      id: true,
      name: true,
    },
  },
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
  clockInRecord: {
    select: {
      id: true,
      type: true,
      clockInDate: true,
      clockInTime: true,
      comment: true,
      distanceToSite: true,
    },
  },
} satisfies Prisma.ReportSelect;

const departureSelect = {
  id: true,
  siteId: true,
  timestampLocal: true,
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
  report: {
    select: {
      id: true,
    },
  },
} satisfies Prisma.ClockInRecordSelect;

function serializeReportItem(report: ReportRow): GeneralSupervisorReportItem {
  return {
    id: report.id,
    siteId: report.siteId,
    siteName: report.site.name,
    authorId: report.userId,
    authorName: `${report.user.firstName} ${report.user.lastName}`,
    authorRole: report.user.role,
    submittedAt: report.submittedAt.toISOString(),
    validationStatus: report.validationStatus,
    excerpt: buildExcerpt(report.content),
  };
}

function serializeMissingReport(departure: DepartureRow): GeneralSupervisorMissingReportItem {
  return {
    id: departure.id,
    siteId: departure.siteId,
    siteName: departure.site.name,
    supervisorId: departure.user.id,
    supervisorName: `${departure.user.firstName} ${departure.user.lastName}`,
    departureAt: departure.timestampLocal.toISOString(),
  };
}

function buildExcerpt(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 150 ? `${compact.slice(0, 147)}...` : compact;
}

function normalizeStatus(status: GeneralSupervisorReportStatusFilter | null) {
  if (!status || status === 'ALL') {
    return null;
  }

  return status;
}

function normalizeDate(value: string | null | undefined) {
  const parsed = cleanString(value);
  if (!parsed) {
    return new Date().toISOString().slice(0, 10);
  }

  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function dateRange(date: string) {
  const from = new Date(`${date}T00:00:00.000Z`);
  const to = new Date(`${date}T23:59:59.999Z`);
  return { from, to };
}

function cleanString(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function emptyReports(date: string): GeneralSupervisorReportsResponse {
  return {
    generatedAt: new Date().toISOString(),
    date,
    summary: {
      received: 0,
      expected: 0,
      missing: 0,
      sites: 0,
    },
    sites: [],
    supervisors: [],
    reports: [],
    missingReports: [],
  };
}
