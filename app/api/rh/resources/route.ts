import { ClockInStatus, ClockInType, OfficeClockInLocation, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessRh, jsonRhError } from '@/lib/rh';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse a la liste des ressources RH.');
  }

  const searchParams = req.nextUrl.searchParams;
  const q = searchParams.get('q')?.trim();
  const role = parseRole(searchParams.get('role'));
  const presenceStatus = parsePresenceStatus(searchParams.get('presenceStatus'));
  const today = toDateOnlyDate(new Date());
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const where: Prisma.UserWhereInput = {
    isActive: true,
    ...(role ? { role } : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            { username: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { matricule: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [items, missingMatricule, roles] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      take: 500,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        matricule: true,
        contact: true,
        role: true,
      },
    }),
    prisma.user.count({
      where: {
        isActive: true,
        OR: [{ matricule: null }, { matricule: '' }],
      },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
      },
      distinct: ['role'],
      select: { role: true },
      orderBy: { role: 'asc' },
    }),
  ]);
  const userIds = items.map((item) => item.id);
  const [assignments, freeMissions, records] = await Promise.all([
    prisma.planningAssignment.findMany({
      where: {
        date: today,
        deletedAt: null,
        workLocationType: 'ON_SITE',
        supervisorId: { in: userIds },
      },
      select: {
        supervisorId: true,
      },
    }),
    prisma.freeMission.findMany({
      where: {
        date: today,
        deletedAt: null,
        assigneeId: { in: userIds },
      },
      select: {
        assigneeId: true,
      },
    }),
    prisma.clockInRecord.findMany({
      where: {
        userId: { in: userIds },
        status: ClockInStatus.VALID,
        timestampLocal: {
          gte: today,
          lt: tomorrow,
        },
        type: {
          in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE, ClockInType.PAUSE_START, ClockInType.PAUSE_END],
        },
      },
      orderBy: [{ userId: 'asc' }, { timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        userId: true,
        type: true,
        timestampLocal: true,
        isLate: true,
        officeClockInLocation: true,
        siteId: true,
        freeMissionId: true,
        isAutoClosed: true,
      },
    }),
  ]);

  const expectedTerrainUserIds = new Set([
    ...assignments.map((assignment) => assignment.supervisorId),
    ...freeMissions.map((mission) => mission.assigneeId),
  ]);
  const recordsByUser = new Map<string, typeof records>();
  for (const record of records) {
    recordsByUser.set(record.userId, [...(recordsByUser.get(record.userId) ?? []), record]);
  }
  const enrichedItems = items.map((item) => ({
    ...item,
    resourceType: item.role === Role.EXTERNAL_RESOURCE ? ('EXTERNAL' as const) : ('INTERNAL' as const),
    todayPresence: buildTodayPresence(recordsByUser.get(item.id) ?? [], expectedTerrainUserIds.has(item.id)),
  }));
  const filteredItems = presenceStatus
    ? enrichedItems.filter((item) => matchesPresenceStatus(item.todayPresence, presenceStatus))
    : enrichedItems;

  return Response.json({
    items: filteredItems,
    totalItems: filteredItems.length,
    missingMatricule,
    roles: roles.map((item) => item.role),
  });
});

function parseRole(value: string | null) {
  if (!value) return null;
  return Object.values(Role).includes(value as Role) ? (value as Role) : null;
}

function parsePresenceStatus(value: string | null) {
  const values = ['present-terrain', 'present-office', 'absent', 'late', 'none'] as const;
  return values.includes(value as (typeof values)[number]) ? (value as (typeof values)[number]) : null;
}

function buildTodayPresence(
  records: {
    type: ClockInType;
    timestampLocal: Date;
    isLate: boolean;
    officeClockInLocation: OfficeClockInLocation | null;
    siteId: string | null;
    freeMissionId: string | null;
    isAutoClosed: boolean;
  }[],
  expectedTerrain: boolean,
) {
  const latest = records.at(-1) ?? null;
  const arrivalIndex = findLastRecordIndex(records, (record) => record.type === ClockInType.ARRIVAL);
  const arrival = arrivalIndex === -1 ? null : records[arrivalIndex] ?? null;
  const departure = arrivalIndex === -1
    ? null
    : [...records.slice(arrivalIndex + 1)].reverse().find((record) => record.type === ClockInType.DEPARTURE) ?? null;
  const context = latest
    ? latest.officeClockInLocation
      ? 'OFFICE'
      : 'TERRAIN'
    : null;

  if (!latest) {
    return expectedTerrain
      ? {
          label: 'Attendu non pointe',
          context: 'TERRAIN' as const,
          status: 'ABSENT' as const,
          arrivalAt: null,
          departureAt: null,
          isLate: false,
        }
      : {
          label: 'Non pointe',
          context: null,
          status: 'NONE' as const,
          arrivalAt: null,
          departureAt: null,
          isLate: false,
        };
  }

  const baseLabel =
    latest.officeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL
      ? 'deplacement professionnel'
      : context === 'OFFICE'
        ? 'bureau'
        : 'terrain';
  const status = records.some((record) => record.isAutoClosed)
    ? 'ANOMALY'
    : latest.type === ClockInType.PAUSE_START
      ? 'PAUSED'
      : latest.type === ClockInType.DEPARTURE
        ? 'LEFT'
        : 'PRESENT';
  const labelByStatus = {
    PRESENT: `Présent ${baseLabel}`,
    PAUSED: `En pause ${baseLabel}`,
    LEFT: `Sorti ${baseLabel}`,
    ANOMALY: 'Anomalie',
  } as const;

  return {
    label: labelByStatus[status],
    context,
    status,
    arrivalAt: arrival?.timestampLocal.toISOString() ?? null,
    departureAt: departure?.timestampLocal.toISOString() ?? null,
    isLate: Boolean(arrival?.isLate),
  };
}

function findLastRecordIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index;
  }

  return -1;
}


function matchesPresenceStatus(
  presence: ReturnType<typeof buildTodayPresence>,
  status: NonNullable<ReturnType<typeof parsePresenceStatus>>,
) {
  if (status === 'present-terrain') return presence.context === 'TERRAIN' && (presence.status === 'PRESENT' || presence.status === 'PAUSED');
  if (status === 'present-office') return presence.context === 'OFFICE' && (presence.status === 'PRESENT' || presence.status === 'PAUSED');
  if (status === 'absent') return presence.status === 'ABSENT';
  if (status === 'late') return presence.isLate;
  return presence.status === 'NONE';
}

function toDateOnlyDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
