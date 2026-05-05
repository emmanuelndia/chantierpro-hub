import {
  ClockInStatus,
  ClockInType,
  Prisma,
  Role,
  TeamMemberStatus,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import { haversineDistanceKm } from '@/lib/haversine';
import type {
  ActiveClockInSession,
  AttendancePersonItem,
  AttendanceToday,
  BatchSyncItemInput,
  BatchSyncItemResult,
  ClockInApiErrorCode,
  ClockInHistoryItem,
  ClockInInput,
  ClockInRecordItem,
  SessionStatus,
  TodayClockInView,
} from '@/types/clock-in';

export const FIELD_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
];

export const clockInRecordSelect = {
  id: true,
  siteId: true,
  userId: true,
  type: true,
  clockInDate: true,
  clockInTime: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  distanceToSite: true,
  status: true,
  comment: true,
  timestampLocal: true,
  createdAt: true,
  site: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.ClockInRecordSelect;

const openSessionSelect = {
  id: true,
  siteId: true,
  type: true,
  status: true,
  timestampLocal: true,
  site: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.ClockInRecordSelect;

const MAX_CLOCK_IN_FUTURE_SKEW_MS = 10 * 60 * 1000;
const MAX_CLOCK_IN_PAST_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type SerializableClockInRecord = Prisma.ClockInRecordGetPayload<{
  select: typeof clockInRecordSelect;
}>;

type OpenSessionRecord = Prisma.ClockInRecordGetPayload<{
  select: typeof openSessionSelect;
}>;

type PauseRecord = {
  id: string;
  siteId: string;
  userId: string;
  type: ClockInType;
  status: ClockInStatus;
  timestampLocal: Date;
};

type AccessibleSite = {
  id: string;
  name: string;
  status: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  radiusKm: Prisma.Decimal;
};

type AttendanceMember = {
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export function jsonClockInError(
  code: ClockInApiErrorCode,
  status: number,
  message: string,
  extra?: Record<string, boolean | number | object | string | null>,
) {
  return Response.json(
    {
      code,
      message,
      ...extra,
    },
    { status },
  );
}

export function isTechnician(role: Role) {
  return FIELD_ROLES.includes(role);
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function parseClockInInput(body: unknown): ClockInInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const type = parseClockInType(body.type);
  const latitude = sanitizeNumber(body.latitude);
  const longitude = sanitizeNumber(body.longitude);
  const timestampLocal = sanitizeDateTimeString(body.timestampLocal);
  const accuracy =
    body.accuracy === undefined || body.accuracy === null ? null : sanitizeNumber(body.accuracy);
  const comment =
    body.comment === undefined || body.comment === null
      ? null
      : typeof body.comment === 'string'
        ? body.comment
        : null;

  if (!type || latitude === null || longitude === null || !timestampLocal) {
    return null;
  }

  if (
    (accuracy !== null && accuracy < 0) ||
    (body.comment !== undefined && body.comment !== null && comment === null)
  ) {
    return null;
  }

  return {
    type,
    latitude,
    longitude,
    accuracy,
    timestampLocal,
    comment,
  };
}

export function getClockInGpsValidationError(input: Pick<ClockInInput, 'latitude' | 'longitude' | 'timestampLocal'>) {
  if (input.latitude < -90 || input.latitude > 90 || input.longitude < -180 || input.longitude > 180) {
    return 'Coordonnees GPS invalides.';
  }

  const timestamp = new Date(input.timestampLocal).getTime();
  const now = Date.now();

  if (timestamp > now + MAX_CLOCK_IN_FUTURE_SKEW_MS) {
    return 'Horodatage GPS incoherent.';
  }

  if (timestamp < now - MAX_CLOCK_IN_PAST_AGE_MS) {
    return 'Horodatage GPS trop ancien.';
  }

  return null;
}

export function parseBatchSyncInput(body: unknown): BatchSyncItemInput[] | null {
  if (!isRecord(body) || !Array.isArray(body.items) || body.items.length === 0) {
    return null;
  }

  const items = body.items.map((item) => {
    if (!isRecord(item)) {
      return null;
    }

    const siteId = sanitizeString(item.siteId);
    const parsed = parseClockInInput(item);

    if (!siteId || !parsed) {
      return null;
    }

    return {
      siteId,
      ...parsed,
    };
  });

  return items.every((item) => item !== null) ? items : null;
}

export function parseCommentInput(body: unknown) {
  if (!isRecord(body) || typeof body.comment !== 'string') {
    return null;
  }

  if (body.comment.length > 1000) {
    return null;
  }

  return {
    comment: body.comment,
  };
}

export function parseNearbySiteQuery(searchParams: URLSearchParams) {
  const latitude = sanitizeNumber(searchParams.get('lat'));
  const longitude = sanitizeNumber(searchParams.get('lng'));

  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

export async function getAccessibleClockInSite(
  prisma: PrismaClient,
  siteId: string,
  userId: string,
) {
  return prisma.site.findFirst({
    where: {
      id: siteId,
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
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
    },
  });
}

export async function getOpenSession(prisma: PrismaClient, siteId: string, userId: string) {
  const records = await prisma.clockInRecord.findMany({
    where: {
      siteId,
      userId,
      status: ClockInStatus.VALID,
    },
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: openSessionSelect,
  });

  return findOpenSessionFromRecords(records);
}

export async function getActivePause(prisma: PrismaClient, siteId: string, userId: string) {
  const records = await prisma.clockInRecord.findMany({
    where: {
      siteId,
      userId,
      status: ClockInStatus.VALID,
      type: {
        in: [ClockInType.PAUSE_START, ClockInType.PAUSE_END],
      },
    },
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      siteId: true,
      userId: true,
      type: true,
      status: true,
      timestampLocal: true,
    },
  });

  return findActivePauseFromRecords(records);
}

export function findOpenSessionFromRecords(records: OpenSessionRecord[]) {
  let openSession: OpenSessionRecord | null = null;

  for (const record of records) {
    if (record.type === ClockInType.ARRIVAL) {
      openSession = record;
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      openSession = null;
    }
  }

  return openSession;
}

export function findActivePauseFromRecords(records: PauseRecord[]) {
  let activePause: PauseRecord | null = null;

  for (const record of records) {
    if (record.type === ClockInType.PAUSE_START) {
      activePause = record;
      continue;
    }

    if (record.type === ClockInType.PAUSE_END) {
      activePause = null;
    }
  }

  return activePause;
}

export function serializeClockInRecord(record: SerializableClockInRecord): ClockInRecordItem {
  return {
    id: record.id,
    siteId: record.siteId,
    siteName: record.site.name,
    userId: record.userId,
    type: record.type,
    clockInDate: record.clockInDate.toISOString().slice(0, 10),
    clockInTime: record.clockInTime.toISOString().slice(11, 19),
    latitude: record.latitude.toNumber(),
    longitude: record.longitude.toNumber(),
    accuracy: record.accuracy?.toNumber() ?? null,
    distanceToSite: record.distanceToSite.toNumber(),
    status: record.status,
    comment: record.comment,
    timestampLocal: record.timestampLocal.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

export function serializeClockInHistory(records: SerializableClockInRecord[]): ClockInHistoryItem[] {
  return records.map(serializeClockInRecord);
}

export function serializeTodayClockInView(payload: {
  date: string;
  activeSession: ActiveClockInSession | null;
  items: SerializableClockInRecord[];
}): TodayClockInView {
  return {
    date: payload.date,
    activeSession: payload.activeSession,
    items: payload.items.map(serializeClockInRecord),
  };
}

export function serializeSessionStatus(
  openSession: OpenSessionRecord | null,
  activePause: PauseRecord | null,
): SessionStatus {
  if (!openSession) {
    return {
      sessionOpen: false,
      arrivalTime: null,
      duration: null,
      pauseActive: false,
      pauseDuration: 0,
    };
  }

  return {
    sessionOpen: true,
    arrivalTime: openSession.timestampLocal.toISOString(),
    duration: durationSince(openSession.timestampLocal),
    pauseActive: Boolean(activePause),
    pauseDuration: activePause ? durationSince(activePause.timestampLocal) : 0,
  };
}

export function serializeActiveSession(record: OpenSessionRecord | null): ActiveClockInSession | null {
  if (!record) {
    return null;
  }

  return {
    siteId: record.siteId,
    siteName: record.site.name,
    arrivalAt: record.timestampLocal.toISOString(),
    durationSeconds: durationSince(record.timestampLocal),
  };
}

export function serializeAttendanceToday(payload: {
  date: string;
  presentNow: AttendanceMember[];
  departedToday: AttendanceMember[];
  absent: AttendanceMember[];
}): AttendanceToday {
  return {
    date: payload.date,
    presentNow: payload.presentNow.map(serializeAttendancePerson),
    departedToday: payload.departedToday.map(serializeAttendancePerson),
    absent: payload.absent.map(serializeAttendancePerson),
  };
}

export async function createClockInRecord(
  prisma: PrismaClient,
  payload: {
    siteId: string;
    userId: string;
    input: ClockInInput;
    distanceKm: number;
    status: ClockInStatus;
  },
) {
  const timestampLocal = new Date(payload.input.timestampLocal);

  const record = await prisma.clockInRecord.create({
    data: {
      siteId: payload.siteId,
      userId: payload.userId,
      type: payload.input.type,
      clockInDate: toDateOnlyDate(timestampLocal),
      clockInTime: timestampLocal,
      latitude: new Prisma.Decimal(payload.input.latitude),
      longitude: new Prisma.Decimal(payload.input.longitude),
      accuracy:
        payload.input.accuracy === null ? null : new Prisma.Decimal(payload.input.accuracy),
      distanceToSite: new Prisma.Decimal(payload.distanceKm.toFixed(2)),
      status: payload.status,
      comment: payload.input.comment ?? null,
      timestampLocal,
    },
    select: clockInRecordSelect,
  });

  return serializeClockInRecord(record);
}

export async function createBatchClockInRecord(
  prisma: PrismaClient,
  payload: {
    siteId: string;
    userId: string;
    input: BatchSyncItemInput;
    distanceKm: number;
    status: ClockInStatus;
  },
) {
  const timestampLocal = new Date(payload.input.timestampLocal);

  return prisma.clockInRecord.create({
    data: {
      siteId: payload.siteId,
      userId: payload.userId,
      type: payload.input.type,
      clockInDate: toDateOnlyDate(timestampLocal),
      clockInTime: timestampLocal,
      latitude: new Prisma.Decimal(payload.input.latitude),
      longitude: new Prisma.Decimal(payload.input.longitude),
      accuracy:
        payload.input.accuracy === null ? null : new Prisma.Decimal(payload.input.accuracy),
      distanceToSite: new Prisma.Decimal(payload.distanceKm.toFixed(2)),
      status: payload.status,
      comment: null,
      timestampLocal,
    },
    select: {
      id: true,
    },
  });
}

export async function updateClockInComment(
  prisma: PrismaClient,
  payload: {
    recordId: string;
    userId: string;
    comment: string;
  },
) {
  const existing = await prisma.clockInRecord.findUnique({
    where: {
      id: payload.recordId,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!existing) {
    return { code: 'NOT_FOUND' as const, record: null };
  }

  if (existing.userId !== payload.userId) {
    return { code: 'FORBIDDEN' as const, record: null };
  }

  const record = await prisma.clockInRecord.update({
    where: {
      id: payload.recordId,
    },
    data: {
      comment: payload.comment,
    },
    select: clockInRecordSelect,
  });

  return {
    code: null,
    record: serializeClockInRecord(record),
  };
}

export function calculateDistanceToSite(
  site: Pick<AccessibleSite, 'latitude' | 'longitude'>,
  input: Pick<ClockInInput, 'latitude' | 'longitude'>,
) {
  return haversineDistanceKm(
    {
      latitude: site.latitude.toNumber(),
      longitude: site.longitude.toNumber(),
    },
    {
      latitude: input.latitude,
      longitude: input.longitude,
    },
  );
}

export function isWithinSiteRadius(site: Pick<AccessibleSite, 'radiusKm'>, distanceKm: number) {
  return distanceKm <= site.radiusKm.toNumber();
}

export function buildOutsideRadiusMessage(
  distanceKm: number,
  radiusKm: number | Pick<AccessibleSite, 'radiusKm'>,
) {
  const allowedRadiusKm =
    typeof radiusKm === 'number' ? radiusKm : radiusKm.radiusKm.toNumber();

  return `vous \u00eates \u00e0 ${distanceKm.toFixed(2)} km du chantier (rayon autoris\u00e9 : ${allowedRadiusKm} km)`;
}

export function buildBatchResult(result: BatchSyncItemResult): BatchSyncItemResult {
  return result;
}

export async function getTodayClockInRecordsForUser(prisma: PrismaClient, userId: string) {
  const today = new Date();
  const todayDate = toDateOnlyDate(today);

  return prisma.clockInRecord.findMany({
    where: {
      userId,
      clockInDate: todayDate,
    },
    orderBy: [{ timestampLocal: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: clockInRecordSelect,
  });
}

export async function getClockInHistoryForUser(prisma: PrismaClient, userId: string) {
  return prisma.clockInRecord.findMany({
    where: {
      userId,
    },
    orderBy: [{ timestampLocal: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: clockInRecordSelect,
  });
}

export async function getClockInHistoryForSiteAndUser(
  prisma: PrismaClient,
  siteId: string,
  userId: string,
) {
  return prisma.clockInRecord.findMany({
    where: {
      siteId,
      userId,
    },
    orderBy: [{ timestampLocal: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: clockInRecordSelect,
  });
}

export async function getAttendanceToday(
  prisma: PrismaClient,
  siteId: string,
): Promise<AttendanceToday> {
  const date = new Date();
  const today = toDateOnlyDate(date);
  const dateLabel = today.toISOString().slice(0, 10);

  const members = await prisma.teamMember.findMany({
    where: {
      status: TeamMemberStatus.ACTIVE,
      team: {
        siteId,
        status: TeamStatus.ACTIVE,
      },
    },
    select: {
      userId: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          role: true,
        },
      },
    },
    orderBy: [{ assignmentDate: 'asc' }, { userId: 'asc' }],
  });

  const uniqueMembers = new Map<string, AttendanceMember>();

  for (const member of members) {
    uniqueMembers.set(member.userId, {
      userId: member.userId,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      role: member.user.role,
    });
  }

  const todayRecords = await prisma.clockInRecord.findMany({
    where: {
      siteId,
      clockInDate: today,
    },
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      userId: true,
      type: true,
      status: true,
    },
  });

  const allRecordUserIds = new Set(todayRecords.map((record) => record.userId));
  const validRecordsByUser = new Map<string, { hasArrival: boolean; hasDeparture: boolean; open: boolean }>();

  for (const record of todayRecords) {
    if (record.status !== ClockInStatus.VALID) {
      continue;
    }

    const state = validRecordsByUser.get(record.userId) ?? {
      hasArrival: false,
      hasDeparture: false,
      open: false,
    };

    if (record.type === ClockInType.ARRIVAL) {
      state.hasArrival = true;
      state.open = true;
    } else if (record.type === ClockInType.DEPARTURE) {
      state.hasDeparture = true;
      state.open = false;
    }

    validRecordsByUser.set(record.userId, state);
  }

  const presentNow: AttendanceMember[] = [];
  const departedToday: AttendanceMember[] = [];
  const absent: AttendanceMember[] = [];

  for (const member of [...uniqueMembers.values()].sort(compareAttendancePeople)) {
    const state = validRecordsByUser.get(member.userId);

    if (state?.open) {
      presentNow.push(member);
      continue;
    }

    if (state?.hasArrival && state.hasDeparture) {
      departedToday.push(member);
      continue;
    }

    if (!allRecordUserIds.has(member.userId)) {
      absent.push(member);
    }
  }

  return serializeAttendanceToday({
    date: dateLabel,
    presentNow,
    departedToday,
    absent,
  });
}

export async function getNearbySites(
  prisma: PrismaClient,
  payload: {
    latitude: number;
    longitude: number;
  },
) {
  const sites = await prisma.site.findMany({
    where: {
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  return sites
    .map((site) => {
      const distance = haversineDistanceKm(
        { latitude: payload.latitude, longitude: payload.longitude },
        {
          latitude: site.latitude.toNumber(),
          longitude: site.longitude.toNumber(),
        },
      );

      return {
        id: site.id,
        name: site.name,
        address: site.address,
        distance,
        radiusKm: site.radiusKm.toNumber(),
      };
    })
    .filter((site) => site.distance <= site.radiusKm)
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
}

function serializeAttendancePerson(person: AttendanceMember): AttendancePersonItem {
  return {
    userId: person.userId,
    firstName: person.firstName,
    lastName: person.lastName,
    role: person.role,
  };
}

function compareAttendancePeople(left: AttendanceMember, right: AttendanceMember) {
  const firstNameComparison = left.firstName.localeCompare(right.firstName);

  if (firstNameComparison !== 0) {
    return firstNameComparison;
  }

  const lastNameComparison = left.lastName.localeCompare(right.lastName);

  if (lastNameComparison !== 0) {
    return lastNameComparison;
  }

  return left.userId.localeCompare(right.userId);
}

function durationSince(value: Date) {
  return Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
}

function sanitizeNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeDateTimeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseClockInType(value: unknown) {
  return typeof value === 'string' && Object.values(ClockInType).includes(value as ClockInType)
    ? (value as ClockInType)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toDateOnlyDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
