import { Prisma, ReportValidationStatus, Role, type PrismaClient } from '@prisma/client';
import type {
  CreateReportInput,
  PaginatedReportsResponse,
  ReportApiErrorCode,
  ReportDetail,
  ReportItem,
} from '@/types/reports';

export const REPORT_CREATE_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
];

export const REPORT_READ_ALL_ROLES: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];

const REPORT_PAGE_SIZE = 15;

export const reportSelect = {
  id: true,
  siteId: true,
  userId: true,
  content: true,
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

export function parseCreateReportInput(body: unknown): CreateReportInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const content = sanitizeString(body.content);
  const clockInRecordId = sanitizeString(body.clockInRecordId);

  if (!content || !clockInRecordId) {
    return null;
  }

  return {
    content,
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

  if (payload.siteIds && !payload.siteIds.includes(report.siteId)) {
    return null;
  }

  return serializeReport(report);
}

export async function validateReportForClient(
  prisma: PrismaClient,
  payload: {
    reportId: string;
    user: AuthLikeUser;
    siteIds: string[];
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

  if (!report || !payload.siteIds.includes(report.siteId)) {
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
  return {
    id: report.id,
    siteId: report.siteId,
    userId: report.userId,
    content: report.content,
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
    },
  };
}

export function serializeReportDetail(report: SerializableReport): ReportDetail {
  return serializeReport(report);
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

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
