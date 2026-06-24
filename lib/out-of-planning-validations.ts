import { ClockInStatus, ClockInType, Role, type PrismaClient } from '@prisma/client';

const OUT_OF_PLANNING_MARKER = 'Pointage hors planning';
const VALIDATION_PREFIX = 'Validation PM :';

const validationSelect = {
  id: true,
  userId: true,
  siteId: true,
  planningAssignmentId: true,
  freeMissionId: true,
  timestampLocal: true,
  distanceToSite: true,
  comment: true,
  user: {
    select: {
      firstName: true,
      lastName: true,
      matricule: true,
      role: true,
    },
  },
  site: {
    select: {
      id: true,
      name: true,
      address: true,
      siteManagerId: true,
      project: {
        select: {
          id: true,
          name: true,
          projectManagerId: true,
        },
      },
    },
  },
};

type ValidationRow = Awaited<ReturnType<typeof findOutOfPlanningRecord>>;
type AuthLikeUser = { id: string; role: Role };

export type OutOfPlanningValidationStatus = 'PENDING' | 'VALIDATED' | 'REFUSED';
export type OutOfPlanningValidationAction = 'VALIDATE' | 'REFUSE';

export function canManageOutOfPlanningValidations(role: Role) {
  return role === Role.PROJECT_MANAGER || role === Role.DIRECTION || role === Role.ADMIN;
}

export function parseOutOfPlanningValidationStatus(value: string | null) {
  if (value === 'VALIDATED' || value === 'REFUSED' || value === 'PENDING') return value;
  return 'PENDING';
}

export function parseOutOfPlanningValidationAction(body: unknown) {
  if (!isRecord(body)) return null;
  const action = body.action;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  if (action !== 'VALIDATE' && action !== 'REFUSE') return null;
  return { action, note } satisfies { action: OutOfPlanningValidationAction; note: string };
}

export async function listOutOfPlanningValidations(
  prisma: PrismaClient,
  user: AuthLikeUser,
  status: OutOfPlanningValidationStatus,
) {
  const rows = await prisma.clockInRecord.findMany({
    where: {
      type: ClockInType.ARRIVAL,
      status: ClockInStatus.VALID,
      siteId: { not: null },
      OR: [
        { comment: { contains: OUT_OF_PLANNING_MARKER } },
        { planningAssignmentId: null, freeMissionId: null, comment: { not: null } },
      ],
      ...(user.role === Role.PROJECT_MANAGER
        ? {
            site: {
              OR: [
                { siteManagerId: user.id },
                { project: { projectManagerId: user.id } },
              ],
            },
          }
        : {}),
    },
    orderBy: [{ timestampLocal: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: validationSelect,
  });

  const items = rows.map(serializeOutOfPlanningValidation).filter((item) => item.validationStatus === status);

  return {
    items,
    summary: {
      total: rows.length,
      pending: rows.filter((row) => getOutOfPlanningValidationStatus(row.comment) === 'PENDING').length,
      validated: rows.filter((row) => getOutOfPlanningValidationStatus(row.comment) === 'VALIDATED').length,
      refused: rows.filter((row) => getOutOfPlanningValidationStatus(row.comment) === 'REFUSED').length,
    },
  };
}

export async function decideOutOfPlanningValidation(
  prisma: PrismaClient,
  payload: {
    recordId: string;
    user: AuthLikeUser;
    action: OutOfPlanningValidationAction;
    note: string;
  },
) {
  const record = await findOutOfPlanningRecord(prisma, payload.recordId);

  if (!record?.site) {
    return { code: 'NOT_FOUND' as const };
  }

  if (
    payload.user.role === Role.PROJECT_MANAGER &&
    record.site.project.projectManagerId !== payload.user.id &&
    record.site.siteManagerId !== payload.user.id
  ) {
    return { code: 'FORBIDDEN' as const };
  }

  if (getOutOfPlanningValidationStatus(record.comment) !== 'PENDING') {
    return { code: 'ALREADY_DECIDED' as const, item: serializeOutOfPlanningValidation(record) };
  }

  const nextComment = buildValidationComment(record.comment ?? '', payload.action, payload.note);
  const updated = await prisma.clockInRecord.update({
    where: { id: payload.recordId },
    data: { comment: nextComment },
    select: validationSelect,
  });

  return { code: null, item: serializeOutOfPlanningValidation(updated) };
}

async function findOutOfPlanningRecord(prisma: PrismaClient, recordId: string) {
  return prisma.clockInRecord.findFirst({
    where: {
      id: recordId,
      type: ClockInType.ARRIVAL,
      status: ClockInStatus.VALID,
      siteId: { not: null },
      OR: [
        { comment: { contains: OUT_OF_PLANNING_MARKER } },
        { planningAssignmentId: null, freeMissionId: null, comment: { not: null } },
      ],
    },
    select: validationSelect,
  });
}

function serializeOutOfPlanningValidation(row: NonNullable<ValidationRow>) {
  return {
    id: row.id,
    resourceName: `${row.user.firstName} ${row.user.lastName}`,
    matricule: row.user.matricule,
    role: row.user.role,
    siteName: row.site?.name ?? 'Chantier',
    siteAddress: row.site?.address ?? '',
    projectName: row.site?.project.name ?? '',
    timestampLocal: row.timestampLocal.toISOString(),
    distanceMeters: Math.round(row.distanceToSite.toNumber() * 1000),
    taskText: extractCommentValue(row.comment, 'Taches prevues :') ?? extractCommentValue(row.comment, 'Taches declarees :') ?? extractCommentValue(row.comment, 'Tache declaree :') ?? getUnplannedClockInComment(row.comment) ?? '',
    validationStatus: getOutOfPlanningValidationStatus(row.comment),
    validationLabel: extractCommentValue(row.comment, VALIDATION_PREFIX) ?? 'en attente',
    decisionNote: extractCommentValue(row.comment, 'Note PM :'),
  };
}

function getUnplannedClockInComment(comment: string | null) {
  const trimmed = comment?.trim();
  if (!trimmed || trimmed.includes(OUT_OF_PLANNING_MARKER)) return null;
  return trimmed;
}
function getOutOfPlanningValidationStatus(comment: string | null): OutOfPlanningValidationStatus {
  const value = extractCommentValue(comment, VALIDATION_PREFIX)?.toLowerCase() ?? '';
  if (value.startsWith('valide')) return 'VALIDATED';
  if (value.startsWith('refuse')) return 'REFUSED';
  return 'PENDING';
}

function buildValidationComment(
  comment: string,
  action: OutOfPlanningValidationAction,
  note: string,
) {
  const lines = comment.split(/\r?\n/).filter((line) => !line.startsWith('Note PM :'));
  const statusText = action === 'VALIDATE' ? 'valide' : 'refuse';
  const nextLines = lines.map((line) =>
    line.startsWith(VALIDATION_PREFIX) ? `${VALIDATION_PREFIX} ${statusText}` : line,
  );

  if (!nextLines.some((line) => line.startsWith(VALIDATION_PREFIX))) {
    nextLines.push(`${VALIDATION_PREFIX} ${statusText}`);
  }

  if (note) {
    nextLines.push(`Note PM : ${note}`);
  }

  return nextLines.join('\n');
}

function extractCommentValue(comment: string | null, prefix: string) {
  if (!comment) return null;
  const line = comment.split(/\r?\n/).find((item) => item.toLowerCase().startsWith(prefix.toLowerCase()));
  const value = line?.slice(prefix.length).trim();
  if (!value) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
