import { ReportValidationStatus, Role, type Prisma, type PrismaClient } from '@prisma/client';
import { createInternalPhotoUrl } from '@/lib/photos';
import { projectAccessWhere } from '@/lib/projects';
import type {
  MobileManagementReportDetailResponse,
  MobileManagementReportItem,
  MobileManagementReportsResponse,
  MobileManagementReportStatusFilter,
} from '@/types/mobile-management-reports';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type ManagementReportFilters = {
  projectId?: string | null;
  siteId?: string | null;
  from?: string | null;
  to?: string | null;
  status?: MobileManagementReportStatusFilter | null;
  q?: string | null;
};

type ReportRow = Prisma.ReportGetPayload<{
  select: typeof managementReportSelect;
}>;

const MANAGEMENT_REPORT_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export function canAccessMobileManagementReports(role: Role) {
  return MANAGEMENT_REPORT_ROLES.includes(role);
}

export async function getMobileManagementReports(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: ManagementReportFilters = {},
): Promise<MobileManagementReportsResponse> {
  if (!canAccessMobileManagementReports(user.role)) {
    return emptyReports();
  }

  const siteWhere = managementReportSiteWhere(user);
  const reportWhere = buildReportWhere(user, filters);

  const [reports, projects, sites] = await Promise.all([
    prisma.report.findMany({
      where: reportWhere,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 80,
      select: managementReportSelect,
    }),
    prisma.project.findMany({
      where: {
        ...projectAccessWhere(user),
        sites: {
          some: {},
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.site.findMany({
      where: siteWhere,
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        projectId: true,
        project: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  const items = reports.map(serializeReportItem);
  const siteIdsWithReports = new Set(items.map((report) => report.siteId));

  return {
    generatedAt: new Date().toISOString(),
    widgets: {
      total: items.length,
      submitted: items.filter((report) => report.validationStatus === ReportValidationStatus.SUBMITTED).length,
      validated: items.filter((report) => report.validationStatus === ReportValidationStatus.VALIDATED_FOR_CLIENT).length,
      sites: siteIdsWithReports.size,
    },
    projects,
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      projectId: site.projectId,
      projectName: site.project.name,
    })),
    reports: items,
  };
}

export async function getMobileManagementReportDetail(
  prisma: PrismaClient,
  user: AuthLikeUser,
  reportId: string,
): Promise<MobileManagementReportDetailResponse | null> {
  if (!canAccessMobileManagementReports(user.role)) {
    return null;
  }

  const report = await prisma.report.findFirst({
    where: {
      id: reportId,
      site: managementReportSiteWhere(user),
    },
    select: managementReportSelect,
  });

  if (!report) {
    return null;
  }

  const submittedAt = report.submittedAt;
  const from = new Date(submittedAt);
  from.setHours(0, 0, 0, 0);
  const to = new Date(submittedAt);
  to.setHours(23, 59, 59, 999);

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

function managementReportSiteWhere(user: AuthLikeUser): Prisma.SiteWhereInput {
  return {
    project: projectAccessWhere(user),
  };
}

function buildReportWhere(user: AuthLikeUser, filters: ManagementReportFilters): Prisma.ReportWhereInput {
  const projectId = cleanString(filters.projectId);
  const siteId = cleanString(filters.siteId);
  const query = cleanString(filters.q);
  const status = normalizeStatus(filters.status ?? null);
  const from = parseDate(filters.from ?? null, false);
  const to = parseDate(filters.to ?? null, true);

  return {
    site: {
      ...managementReportSiteWhere(user),
      ...(projectId ? { projectId } : {}),
    },
    ...(siteId ? { siteId } : {}),
    ...(status ? { validationStatus: status } : {}),
    ...(from || to
      ? {
          submittedAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
    ...(query
      ? {
          OR: [
            { content: { contains: query, mode: 'insensitive' } },
            { site: { name: { contains: query, mode: 'insensitive' } } },
            { site: { project: { name: { contains: query, mode: 'insensitive' } } } },
            { user: { firstName: { contains: query, mode: 'insensitive' } } },
            { user: { lastName: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

const managementReportSelect = {
  id: true,
  siteId: true,
  userId: true,
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
      projectId: true,
      project: {
        select: {
          id: true,
          name: true,
        },
      },
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

function serializeReportItem(report: ReportRow): MobileManagementReportItem {
  return {
    id: report.id,
    projectId: report.site.project.id,
    projectName: report.site.project.name,
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

function buildExcerpt(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 150 ? `${compact.slice(0, 147)}...` : compact;
}

function normalizeStatus(status: MobileManagementReportStatusFilter | null) {
  if (!status || status === 'ALL') {
    return null;
  }

  return status;
}

function cleanString(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function parseDate(value: string | null, endOfDay: boolean) {
  const clean = cleanString(value);
  if (!clean) {
    return null;
  }

  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
}

function emptyReports(): MobileManagementReportsResponse {
  return {
    generatedAt: new Date().toISOString(),
    widgets: {
      total: 0,
      submitted: 0,
      validated: 0,
      sites: 0,
    },
    projects: [],
    sites: [],
    reports: [],
  };
}
