import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import {
  GeneralSupervisorSiteScopeStatus,
  PhotoTag,
  Prisma,
  ProjectStatus,
  ReportStatus,
  ReportValidationStatus,
  Role,
  type PrismaClient,
} from '@prisma/client';
import { documentAttachmentSelect, serializeDocumentAttachment } from '@/lib/documents';
import {
  BUSINESS_FIELD_RESOURCE_ROLES,
  BUSINESS_MANAGER_ROLES,
  getBusinessManagedResourceRoles,
  isBusinessManagerRole,
} from '@/lib/field-roles';
import { createInternalPhotoUrl } from '@/lib/photos';
import { projectAccessWhere } from '@/lib/projects';
import type {
  CreateReportInput,
  PaginatedReportsResponse,
  ReportApiErrorCode,
  ReportDetail,
  ReportItem,
  WebReportCoveragePeriod,
  WebReportItem,
  WebReportSiteCoverageItem,
  WebReportsResponse,
  WebReportStatusFilter,
  WebReportValidationFilter,
} from '@/types/reports';

export const REPORT_CREATE_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.RESOURCE,
  Role.EXTERNAL_RESOURCE,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  ...BUSINESS_FIELD_RESOURCE_ROLES,
];

export const REPORT_READ_ALL_ROLES: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  ...BUSINESS_MANAGER_ROLES,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];

const REPORT_PAGE_SIZE = 15;
const WEB_REPORT_PAGE_SIZE = 15;
const WEB_REPORT_MAX_EXPORT_ROWS = 1000;

export const reportSelect = {
  id: true,
  siteId: true,
  freeMissionId: true,
  userId: true,
  content: true,
  progression: true,
  blocage: true,
  status: true,
  submittedAt: true,
  createdAt: true,
  validationStatus: true,
  validatedForClientAt: true,
  validatedForClientById: true,
  validatedForClientBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
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
  site: {
    select: {
      id: true,
      name: true,
      projectId: true,
      project: {
        select: {
          id: true,
          name: true,
          projectManagerId: true,
        },
      },
    },
  },
  _count: {
    select: {
      documentAttachments: {
        where: {
          isDeleted: false,
        },
      },
    },
  },
  freeMission: {
    select: {
      id: true,
      action: true,
      projectId: true,
      project: {
        select: {
          id: true,
          name: true,
          projectManagerId: true,
        },
      },
    },
  },
} satisfies Prisma.ReportSelect;

type SerializableReport = Prisma.ReportGetPayload<{
  select: typeof reportSelect;
}>;

type AuthLikeUser = {
  id: string;
  role: Role;
};

type WebReportQuery = {
  page: number;
  from: Date | null;
  to: Date | null;
  projectId: string | null;
  siteId: string | null;
  resourceId: string | null;
  status: WebReportStatusFilter;
  validationStatus: WebReportValidationFilter;
  q: string | null;
  coveragePeriod: WebReportCoveragePeriod;
};

type WebExportFormat = 'csv' | 'xlsx' | 'pdf' | 'txt';

export function jsonReportError(code: ReportApiErrorCode, status: number, message: string) {
  return Response.json(
    {
      code,
      message,
    },
    { status },
  );
}

export function canCreateReports(role: Role) {
  return REPORT_CREATE_ROLES.includes(role);
}

export function canReadAllReports(role: Role) {
  return REPORT_READ_ALL_ROLES.includes(role);
}

export function canValidateReportsForClient(role: Role) {
  return role === Role.COORDINATOR;
}

export function canAccessWebReports(role: Role) {
  return REPORT_READ_ALL_ROLES.includes(role);
}

export function parseWebReportQuery(searchParams: URLSearchParams): WebReportQuery | null {
  const status = parseReportStatusFilter(searchParams.get('status'));
  const validationStatus = parseValidationStatusFilter(searchParams.get('validationStatus'));

  if (!status || !validationStatus) {
    return null;
  }

  return {
    page: parsePage(searchParams.get('page')),
    from: parseDate(searchParams.get('from'), false),
    to: parseDate(searchParams.get('to'), true),
    projectId: sanitizeString(searchParams.get('projectId')),
    siteId: sanitizeString(searchParams.get('siteId')),
    resourceId: sanitizeString(searchParams.get('resourceId')),
    status,
    validationStatus,
    q: sanitizeString(searchParams.get('q')),
    coveragePeriod: parseCoveragePeriod(searchParams.get('coveragePeriod')),
  };
}

export function parseWebReportExportFormat(value: string | null): WebExportFormat | null {
  if (!value) {
    return 'csv';
  }

  return ['csv', 'xlsx', 'pdf', 'txt'].includes(value) ? (value as WebExportFormat) : null;
}

export function parseCreateReportInput(body: unknown): CreateReportInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const content = sanitizeString(body.content);
  const clockInRecordId = sanitizeString(body.clockInRecordId);

  if (!clockInRecordId) {
    return null;
  }

  return {
    content: content ?? '',
    clockInRecordId,
  };
}

export function parseReportListQuery(searchParams: URLSearchParams) {
  const page = parsePage(searchParams.get('page'));
  const userId = sanitizeString(searchParams.get('userId'));
  const from = parseDate(searchParams.get('from'));
  const to = parseDate(searchParams.get('to'));

  return {
    page,
    userId,
    from,
    to,
  };
}

export async function createReport(
  prisma: PrismaClient,
  payload: {
    siteId: string;
    user: AuthLikeUser;
    input: CreateReportInput;
  },
) {
  const clockInRecord = await prisma.clockInRecord.findUnique({
    where: {
      id: payload.input.clockInRecordId,
    },
    select: {
      id: true,
      siteId: true,
      userId: true,
    },
  });

  if (clockInRecord?.siteId !== payload.siteId) {
    return { code: 'NOT_FOUND' as const, report: null };
  }

  if (clockInRecord.userId !== payload.user.id) {
    return { code: 'FORBIDDEN' as const, report: null };
  }

  try {
    const report = await prisma.report.create({
      data: {
        siteId: payload.siteId,
        userId: payload.user.id,
        clockInRecordId: payload.input.clockInRecordId,
        content: payload.input.content,
      },
      select: reportSelect,
    });

    return {
      code: null,
      report: serializeReport(report),
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { code: 'CONFLICT' as const, report: null };
    }

    throw error;
  }
}

export async function getPaginatedSiteReports(
  prisma: PrismaClient,
  payload: {
    siteId: string;
    user: AuthLikeUser;
    page: number;
    from: Date | null;
    to: Date | null;
    userId: string | null;
  },
): Promise<PaginatedReportsResponse> {
  const where: Prisma.ReportWhereInput = {
    siteId: payload.siteId,
  };

  if (!canReadAllReports(payload.user.role)) {
    where.userId = payload.user.id;
  } else if (payload.userId) {
    where.userId = payload.userId;
  }

  if (payload.from || payload.to) {
    where.submittedAt = {};

    if (payload.from) {
      where.submittedAt.gte = payload.from;
    }

    if (payload.to) {
      where.submittedAt.lte = payload.to;
    }
  }

  const [items, totalItems] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      skip: (payload.page - 1) * REPORT_PAGE_SIZE,
      take: REPORT_PAGE_SIZE,
      select: reportSelect,
    }),
    prisma.report.count({ where }),
  ]);

  return {
    items: items.map(serializeReport),
    page: payload.page,
    pageSize: REPORT_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / REPORT_PAGE_SIZE)),
  };
}

export async function getWebReports(
  prisma: PrismaClient,
  user: AuthLikeUser,
  query: WebReportQuery,
): Promise<WebReportsResponse | null> {
  if (!canAccessWebReports(user.role)) {
    return null;
  }

  const siteWhere = await getWebReportSiteWhere(prisma, user);
  const where = buildWebReportWhere(siteWhere, query);
  const optionsWhere = siteWhere;
  const coverageRange = buildCoverageRange(query.coveragePeriod);

  const [items, totalItems, totalSubmitted, totalValidated, siteRows, projects, sites, resources, siteCoverage] =
    await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * WEB_REPORT_PAGE_SIZE,
        take: WEB_REPORT_PAGE_SIZE,
        select: reportSelect,
      }),
      prisma.report.count({ where }),
      prisma.report.count({
        where: {
          ...where,
          validationStatus: ReportValidationStatus.SUBMITTED,
        },
      }),
      prisma.report.count({
        where: {
          ...where,
          validationStatus: ReportValidationStatus.VALIDATED_FOR_CLIENT,
        },
      }),
      prisma.report.findMany({
        where,
        distinct: ['siteId'],
        select: {
          siteId: true,
        },
      }),
      prisma.project.findMany({
        where: {
          sites: {
            some: optionsWhere,
          },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.site.findMany({
        where: optionsWhere,
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
      prisma.user.findMany({
        where: {
          isActive: true,
          reports: {
            some: {
              site: optionsWhere,
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
      buildWebReportSiteCoverage(prisma, optionsWhere, coverageRange),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    page: query.page,
    pageSize: WEB_REPORT_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / WEB_REPORT_PAGE_SIZE)),
    coveragePeriod: query.coveragePeriod,
    siteCoverage,
    widgets: {
      total: totalItems,
      submitted: totalSubmitted,
      validated: totalValidated,
      sites: siteRows.length,
    },
    options: {
      projects,
      sites: sites.map((site) => ({
        id: site.id,
        name: site.name,
        projectId: site.projectId,
        projectName: site.project.name,
      })),
      resources: resources.map((resource) => ({
        id: resource.id,
        name: `${resource.firstName} ${resource.lastName}`,
        role: resource.role,
      })),
    },
    items: items.map(serializeWebReportItem),
  };
}

export async function buildWebReportsExport(
  prisma: PrismaClient,
  user: AuthLikeUser,
  query: WebReportQuery,
  format: WebExportFormat,
) {
  if (!canAccessWebReports(user.role)) {
    return null;
  }

  const siteWhere = await getWebReportSiteWhere(prisma, user);
  const where = buildWebReportWhere(siteWhere, query);
  const reports = await prisma.report.findMany({
    where,
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    take: WEB_REPORT_MAX_EXPORT_ROWS,
    select: reportSelect,
  });
  const rows = reports.map(serializeWebReportItem);
  const dateKey = new Date().toISOString().slice(0, 10);

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Rapports');
    worksheet.columns = [
      { header: 'Date', key: 'submittedAt', width: 24 },
      { header: 'Ressource', key: 'authorName', width: 28 },
      { header: 'Role', key: 'authorRole', width: 20 },
      { header: 'Projet', key: 'projectName', width: 28 },
      { header: 'Chantier', key: 'siteName', width: 28 },
      { header: 'Progression', key: 'progression', width: 14 },
      { header: 'Statut', key: 'status', width: 16 },
      { header: 'Validation client', key: 'validationStatus', width: 22 },
      { header: 'Blocage', key: 'blocage', width: 35 },
      { header: 'Extrait', key: 'excerpt', width: 60 },
    ];
    worksheet.addRows(rows);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    return {
      fileName: `rapports-web-${dateKey}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: buffer,
    };
  }

  if (format === 'pdf') {
    const pdf = new jsPDF({ orientation: 'landscape' });
    const margin = 12;
    let y = margin;
    pdf.setFontSize(16);
    pdf.text('Rapports terrain - ChantierPro', margin, y);
    y += 10;
    pdf.setFontSize(8);

    for (const report of rows) {
      if (y > 190) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(
        `${formatDateTime(report.submittedAt)} | ${report.authorName} | ${report.projectName} | ${report.siteName} | ${report.validationStatus}`,
        margin,
        y,
      );
      y += 5;
      const lines = pdf.splitTextToSize(report.excerpt, 260) as string[];
      for (const line of lines.slice(0, 2)) {
        pdf.text(line, margin, y);
        y += 5;
      }
      y += 2;
    }

    return {
      fileName: `rapports-web-${dateKey}.pdf`,
      contentType: 'application/pdf',
      body: Buffer.from(pdf.output('arraybuffer')),
    };
  }

  const separator = format === 'txt' ? '\t' : ',';
  const contentType = format === 'txt' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8';
  const extension = format === 'txt' ? 'txt' : 'csv';
  const header = [
    'Date',
    'Ressource',
    'Role',
    'Projet',
    'Chantier',
    'Progression',
    'Statut',
    'Validation client',
    'Blocage',
    'Extrait',
  ];
  const lines = [
    header.map((value) => escapeSeparatedValue(value, separator)).join(separator),
    ...rows.map((report) =>
      [
        report.submittedAt,
        report.authorName,
        report.authorRole,
        report.projectName,
        report.siteName,
        report.progression === null ? '' : String(report.progression),
        report.status,
        report.validationStatus,
        report.blocage ?? '',
        report.excerpt,
      ]
        .map((value) => escapeSeparatedValue(value, separator))
        .join(separator),
    ),
  ];

  return {
    fileName: `rapports-web-${dateKey}.${extension}`,
    contentType,
    body: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'),
  };
}

export async function getAccessibleReportById(
  prisma: PrismaClient,
  payload: {
    reportId: string;
    user: AuthLikeUser;
    siteIds?: string[];
  },
) {
  const report = await prisma.report.findUnique({
    where: {
      id: payload.reportId,
    },
    select: reportSelect,
  });

  if (!report) {
    return null;
  }

  if (!canReadAllReports(payload.user.role) && report.userId !== payload.user.id) {
    return null;
  }

  if (payload.siteIds && (!report.siteId || !payload.siteIds.includes(report.siteId))) {
    return null;
  }

  if (canReadAllReports(payload.user.role) && report.siteId && !(await canAccessReportSite(prisma, payload.user, report.siteId))) {
    return null;
  }

  const submittedDay = dayRange(report.submittedAt);
  const [photos, attachments] = await Promise.all([
    prisma.photo.findMany({
      where: {
        ...(report.siteId ? { siteId: report.siteId } : { freeMissionId: report.freeMissionId }),
        uploadedById: report.userId,
        isDeleted: false,
        timestampLocal: {
          gte: submittedDay.from,
          lte: submittedDay.to,
        },
      },
    orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
    take: 8,
    select: {
      id: true,
      filename: true,
      timestampLocal: true,
      tags: true,
      description: true,
      planningAssignmentId: true,
      planningAssignment: {
        select: {
          action: true,
        },
      },
    },
    }),
    prisma.documentAttachment.findMany({
      where: {
        reportId: report.id,
        isDeleted: false,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: documentAttachmentSelect,
    }),
  ]);

  return serializeReportDetail(report, photos, attachments);
}

export async function validateReportForClient(
  prisma: PrismaClient,
  payload: {
    reportId: string;
    user: AuthLikeUser;
  },
) {
  if (!canValidateReportsForClient(payload.user.role)) {
    return { code: 'FORBIDDEN' as const, report: null };
  }

  const report = await prisma.report.findUnique({
    where: {
      id: payload.reportId,
    },
    select: {
      id: true,
      siteId: true,
      validationStatus: true,
    },
  });

  if (!report || (report.siteId && !(await canAccessReportSite(prisma, payload.user, report.siteId)))) {
    return { code: 'NOT_FOUND' as const, report: null };
  }

  if (report.validationStatus === ReportValidationStatus.VALIDATED_FOR_CLIENT) {
    return { code: 'ALREADY_VALIDATED' as const, report: null };
  }

  const updatedReport = await prisma.report.update({
    where: {
      id: report.id,
    },
    data: {
      validationStatus: ReportValidationStatus.VALIDATED_FOR_CLIENT,
      validatedForClientAt: new Date(),
      validatedForClientById: payload.user.id,
    },
    select: reportSelect,
  });

  return {
    code: null,
    report: serializeReport(updatedReport),
  };
}

export function serializeReport(report: SerializableReport): ReportItem {
  const project = report.site?.project ?? report.freeMission?.project;
  return {
    id: report.id,
    siteId: report.siteId,
    siteName: report.site?.name ?? report.freeMission?.action ?? 'Mission libre',
    projectId: project?.id ?? '',
    projectName: project?.name ?? 'Projet',
    userId: report.userId,
    content: report.content,
    hasText: report.content.trim().length > 0,
    hasAttachments: report._count.documentAttachments > 0,
    attachmentsCount: report._count.documentAttachments,
    progression: report.progression,
    blocage: report.blocage,
    status: report.status,
    validationStatus: report.validationStatus,
    validatedForClientAt: report.validatedForClientAt?.toISOString() ?? null,
    validatedForClientBy: report.validatedForClientBy
      ? {
          id: report.validatedForClientBy.id,
          firstName: report.validatedForClientBy.firstName,
          lastName: report.validatedForClientBy.lastName,
          role: report.validatedForClientBy.role,
        }
      : null,
    submittedAt: report.submittedAt.toISOString(),
    createdAt: report.createdAt.toISOString(),
    author: {
      id: report.user.id,
      firstName: report.user.firstName,
      lastName: report.user.lastName,
      role: report.user.role,
    },
    session: {
      id: report.clockInRecord.id,
      type: report.clockInRecord.type,
      date: report.clockInRecord.clockInDate.toISOString().slice(0, 10),
      time: report.clockInRecord.clockInTime.toISOString().slice(11, 19),
      comment: report.clockInRecord.comment,
      distanceToSite: report.clockInRecord.distanceToSite.toNumber(),
    },
  };
}

export function serializeReportDetail(
  report: SerializableReport,
  photos: {
    id: string;
    filename: string;
    timestampLocal: Date;
    tags: PhotoTag[];
    description: string | null;
    planningAssignmentId: string | null;
    planningAssignment: { action: string } | null;
  }[] = [],
  attachments: Prisma.DocumentAttachmentGetPayload<{ select: typeof documentAttachmentSelect }>[] = [],
): ReportDetail {
  return {
    ...serializeReport(report),
    photos: photos.map((photo) => ({
      id: photo.id,
      filename: photo.filename,
      url: createInternalPhotoUrl(photo.id),
      takenAt: photo.timestampLocal.toISOString(),
      tags: photo.tags,
      planningAssignmentId: photo.planningAssignmentId,
      ...(photo.planningAssignment ? { assignmentAction: photo.planningAssignment.action } : {}),
      ...(photo.description ? { description: photo.description } : {}),
    })),
    attachments: attachments.map(serializeDocumentAttachment),
  };
}

async function getWebReportSiteWhere(prisma: PrismaClient, user: AuthLikeUser): Promise<Prisma.SiteWhereInput> {
  if (user.role === Role.COORDINATOR) {
    const projectManagerIds = await getCoordinatorProjectManagerIds(prisma, user.id);
    return {
      project: {
        projectManagerId: { in: projectManagerIds },
        status: { not: ProjectStatus.ARCHIVED },
      },
    };
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    return {
      OR: [
        {
          project: {
            status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] },
          },
          generalSupervisorScopes: {
            some: {
              generalSupervisorId: user.id,
              status: GeneralSupervisorSiteScopeStatus.ACTIVE,
            },
          },
        },
        {
          project: {
            status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] },
            generalSupervisorProjectScopes: {
              some: {
                generalSupervisorId: user.id,
                status: GeneralSupervisorSiteScopeStatus.ACTIVE,
              },
            },
          },
        },
      ],
    };
  }

  if (isBusinessManagerRole(user.role)) {
    return {
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

  if (user.role === Role.PROJECT_MANAGER) {
    return {
      project: projectAccessWhere(user),
    };
  }

  return {};
}

export async function getCoordinatorScopedSiteIds(prisma: PrismaClient, coordinatorId: string) {
  const projectManagerIds = await getCoordinatorProjectManagerIds(prisma, coordinatorId);
  if (projectManagerIds.length === 0) {
    return [];
  }

  const sites = await prisma.site.findMany({
    where: {
      project: {
        projectManagerId: { in: projectManagerIds },
        status: { not: ProjectStatus.ARCHIVED },
      },
    },
    select: {
      id: true,
    },
  });

  return sites.map((site) => site.id);
}

async function getCoordinatorProjectManagerIds(prisma: PrismaClient, coordinatorId: string) {
  const scopes = await prisma.coordinatorProjectManagerScope.findMany({
    where: {
      coordinatorId,
      coordinator: {
        isActive: true,
        role: Role.COORDINATOR,
      },
      projectManager: {
        isActive: true,
        role: Role.PROJECT_MANAGER,
      },
    },
    select: {
      projectManagerId: true,
    },
  });

  return scopes.map((scope) => scope.projectManagerId);
}

async function canAccessReportSite(prisma: PrismaClient, user: AuthLikeUser, siteId: string) {
  if (user.role === Role.DIRECTION || user.role === Role.ADMIN) {
    return true;
  }

  const siteWhere = await getWebReportSiteWhere(prisma, user);
  const count = await prisma.site.count({
    where: {
      id: siteId,
      ...siteWhere,
    },
  });

  return count > 0;
}

function buildWebReportWhere(
  siteScope: Prisma.SiteWhereInput,
  query: WebReportQuery,
): Prisma.ReportWhereInput {
  return {
    site: {
      ...siteScope,
      ...(query.projectId ? { projectId: query.projectId } : {}),
    },
    ...(query.siteId ? { siteId: query.siteId } : {}),
    ...(query.resourceId ? { userId: query.resourceId } : {}),
    ...(query.status !== 'ALL' ? { status: query.status } : {}),
    ...(query.validationStatus !== 'ALL' ? { validationStatus: query.validationStatus } : {}),
    ...(query.from || query.to
      ? {
          submittedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            { content: { contains: query.q, mode: 'insensitive' } },
            { blocage: { contains: query.q, mode: 'insensitive' } },
            { site: { name: { contains: query.q, mode: 'insensitive' } } },
            { site: { project: { name: { contains: query.q, mode: 'insensitive' } } } },
            { user: { firstName: { contains: query.q, mode: 'insensitive' } } },
            { user: { lastName: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

function serializeWebReportItem(report: SerializableReport): WebReportItem {
  const project = report.site?.project ?? report.freeMission?.project;
  return {
    id: report.id,
    projectId: project?.id ?? '',
    projectName: project?.name ?? 'Projet',
    siteId: report.siteId,
    siteName: report.site?.name ?? report.freeMission?.action ?? 'Mission libre',
    authorId: report.userId,
    authorName: `${report.user.firstName} ${report.user.lastName}`,
    authorRole: report.user.role,
    submittedAt: report.submittedAt.toISOString(),
    progression: report.progression,
    blocage: report.blocage,
    status: report.status,
    validationStatus: report.validationStatus,
    excerpt: buildExcerpt(report.content),
    hasText: report.content.trim().length > 0,
    hasAttachments: report._count.documentAttachments > 0,
    attachmentsCount: report._count.documentAttachments,
  };
}

function buildExcerpt(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'Rapport avec pièce jointe';
  }
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function parseReportStatusFilter(value: string | null): WebReportStatusFilter | null {
  if (!value) {
    return 'ALL';
  }

  if (value === 'ALL') {
    return 'ALL';
  }

  return Object.values(ReportStatus).includes(value as ReportStatus)
    ? (value as ReportStatus)
    : null;
}

function parseValidationStatusFilter(value: string | null): WebReportValidationFilter | null {
  if (!value) {
    return 'ALL';
  }

  if (value === 'ALL') {
    return 'ALL';
  }

  return Object.values(ReportValidationStatus).includes(value as ReportValidationStatus)
    ? (value as ReportValidationStatus)
    : null;
}

function parseCoveragePeriod(value: string | null): WebReportCoveragePeriod {
  return value === 'week' ? 'week' : 'today';
}

function buildCoverageRange(period: WebReportCoveragePeriod) {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

  if (period === 'week') {
    const day = todayStart.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const from = new Date(todayStart);
    from.setUTCDate(todayStart.getUTCDate() + mondayOffset);
    const to = new Date(from);
    to.setUTCDate(from.getUTCDate() + 7);
    return { from, to };
  }

  const to = new Date(todayStart);
  to.setUTCDate(todayStart.getUTCDate() + 1);
  return { from: todayStart, to };
}

async function buildWebReportSiteCoverage(
  prisma: PrismaClient,
  siteWhere: Prisma.SiteWhereInput,
  period: { from: Date; to: Date },
): Promise<WebReportSiteCoverageItem[]> {
  const sites = await prisma.site.findMany({
    where: siteWhere,
    orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      projectId: true,
      project: {
        select: {
          name: true,
          projectManager: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      reports: {
        where: {
          submittedAt: {
            gte: period.from,
            lt: period.to,
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          submittedAt: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });

  return sites.map((site) => {
    const latestReport = site.reports[0] ?? null;
    return {
      projectId: site.projectId,
      projectName: site.project.name,
      projectManagerName: `${site.project.projectManager.firstName} ${site.project.projectManager.lastName}`,
      siteId: site.id,
      siteName: site.name,
      reportsCount: site.reports.length,
      latestReportAt: latestReport?.submittedAt.toISOString() ?? null,
      latestReportAuthorName: latestReport
        ? `${latestReport.user.firstName} ${latestReport.user.lastName}`
        : null,
      status: site.reports.length > 0 ? 'RECEIVED' : 'MISSING',
    };
  });
}

function dayRange(date: Date) {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return { from, to };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function escapeSeparatedValue(value: string, separator: string) {
  if (separator === '\t') {
    return value.replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePage(value: string | null) {
  if (!value) {
    return 1;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseDate(value: string | null, endOfDay = false) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
