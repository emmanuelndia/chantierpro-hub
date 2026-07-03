import { ClockInStatus, ClockInType, OfficeClockInLocation, PlanningWorkLocationType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createClockInRecord,
  findActivePauseFromRecords,
  getClockInGpsValidationError,
  getOpenSessionForUser,
  jsonClockInError,
  parseClockInInput,
  parseJsonBody,
  serializeOpenSessionError,
} from '@/lib/clock-in';
import { withAuth } from '@/lib/auth/with-auth';
import { haversineDistanceKm } from '@/lib/haversine';
import { getActiveOfficeLocation, getOfficeLocationById } from '@/lib/office-locations';

const PROFESSIONAL_TRAVEL_ROLES: readonly Role[] = [Role.OFFICE_STAFF, Role.HR, Role.DIRECTION, Role.ADMIN, Role.AUDITOR, Role.PROJECT_MANAGER];

export const POST = withAuth(async ({ req, user }) => {
  const body = await parseJsonBody<unknown>(req);
  const input = parseClockInInput(body);
  const officeLocationId = parseOfficeLocationId(body);
  const requestedPlanningAssignmentId = parsePlanningAssignmentId(body);
  const requestedOfficeClockInLocation = parseOfficeClockInLocation(body);
  const officeClockInLocation =
    input?.type === ClockInType.ARRIVAL
      ? requestedOfficeClockInLocation
      : null;

  if (!input || !requestedOfficeClockInLocation) {
    return jsonClockInError('BAD_REQUEST', 400, 'Payload de pointage bureau invalide.');
  }

  if (
    requestedOfficeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL &&
    !PROFESSIONAL_TRAVEL_ROLES.includes(user.role)
  ) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Le deplacement professionnel est reserve aux profils bureau et aux chefs projets.');
  }

  if (input.type === ClockInType.ARRIVAL) {
    if (officeClockInLocation === OfficeClockInLocation.OFFICE && !officeLocationId) {
      return jsonClockInError('BAD_REQUEST', 400, 'Selectionnez un bureau avant de pointer.');
    }

    if (officeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL) {
      const travelDetails = parseProfessionalTravelDetails(body);
      if (!travelDetails) {
        return jsonClockInError('BAD_REQUEST', 400, 'Renseignez la ville et le motif du deplacement.');
      }
      input.comment = buildProfessionalTravelComment(travelDetails);
    }
  }

  const gpsError = getClockInGpsValidationError(input);
  if (gpsError) {
    return jsonClockInError('GPS_SPOOFING_SUSPECTED', 400, gpsError);
  }

  const openSession = await getOpenSessionForUser(prisma, user.id);
  const activeOfficeClockInLocation = input.type === ClockInType.ARRIVAL ? officeClockInLocation : openSession?.officeClockInLocation ?? null;
  const officeLocation =
    input.type === ClockInType.ARRIVAL && officeClockInLocation === OfficeClockInLocation.OFFICE
      ? await getActiveOfficeLocation(prisma, officeLocationId!)
      : openSession?.officeLocationId
        ? await getOfficeLocationById(prisma, openSession.officeLocationId)
        : null;

  if (activeOfficeClockInLocation === OfficeClockInLocation.OFFICE && !officeLocation) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Bureau introuvable ou inactif.');
  }

  if (input.type === ClockInType.ARRIVAL && openSession) {
    return jsonClockInError('SESSION_ALREADY_OPEN', 409, 'Une session de pointage est deja ouverte.', {
      openSession: serializeOpenSessionError(openSession),
    });
  }

  if (input.type !== ClockInType.ARRIVAL) {
    if (!openSession) {
      return jsonClockInError('NO_OPEN_SESSION', 400, 'Aucune session bureau ouverte.');
    }

    if (!openSession.officeClockInLocation) {
      return jsonClockInError('PERMISSION_DENIED', 400, 'La session ouverte ne concerne pas le bureau.');
    }
  }

  if (input.type === ClockInType.ARRIVAL && officeClockInLocation === OfficeClockInLocation.OFFICE) {
    if (!officeLocation) {
      return jsonClockInError('PERMISSION_DENIED', 403, 'Bureau introuvable ou inactif.');
    }

    const distanceKm = haversineDistanceKm(
      {
        latitude: input.latitude,
        longitude: input.longitude,
      },
      {
        latitude: officeLocation.latitude.toNumber(),
        longitude: officeLocation.longitude.toNumber(),
      },
    );

    if (distanceKm > officeLocation.radiusKm.toNumber()) {
      return jsonClockInError('OUTSIDE_RADIUS', 400, 'Vous etes hors du rayon autorise pour ce bureau.');
    }
  }

  const assignmentValidation =
    input.type === ClockInType.ARRIVAL
      ? await validateOfficePlanningAssignment(user.id, requestedPlanningAssignmentId, input.timestampLocal)
      : { ok: true as const, assignmentId: openSession?.planningAssignmentId ?? null };

  if (!assignmentValidation.ok) {
    return jsonClockInError('NOT_FOUND', 404, assignmentValidation.message);
  }

  const linkedAssignmentId = assignmentValidation.assignmentId;

  if (input.type === ClockInType.PAUSE_START || input.type === ClockInType.PAUSE_END) {
    const officeRecords = await prisma.clockInRecord.findMany({
      where: {
        userId: user.id,
        officeClockInLocation: activeOfficeClockInLocation,
        status: ClockInStatus.VALID,
      },
      orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        siteId: true,
        freeMissionId: true,
        planningAssignmentId: true,
        officeClockInLocation: true,
        userId: true,
        type: true,
        status: true,
        timestampLocal: true,
      },
    });
    const activePause = findActivePauseFromRecords(officeRecords);

    if (input.type === ClockInType.PAUSE_START && activePause) {
      return jsonClockInError('PAUSE_ALREADY_ACTIVE', 400, 'Une pause bureau est deja active.');
    }

    if (input.type === ClockInType.PAUSE_END && !activePause) {
      return jsonClockInError('NO_ACTIVE_PAUSE', 400, 'Aucune pause bureau active.');
    }
  }

  if (input.type === ClockInType.DEPARTURE && openSession) {
    const inputDate = new Date(input.timestampLocal);
    if (inputDate.getTime() <= openSession.timestampLocal.getTime()) {
      return jsonClockInError('DEPARTURE_BEFORE_ARRIVAL', 400, "L'heure de sortie doit etre apres l'entree.");
    }
  }

  const isClosingStaleSession =
    input.type === ClockInType.DEPARTURE &&
    Boolean(openSession?.officeClockInLocation) &&
    openSession!.clockInDate.toISOString().slice(0, 10) !== new Date(input.timestampLocal).toISOString().slice(0, 10);
  const record = await createClockInRecord(prisma, {
    officeClockInLocation: activeOfficeClockInLocation,
    officeLocationId: activeOfficeClockInLocation === OfficeClockInLocation.OFFICE ? officeLocation?.id ?? null : null,
    planningAssignmentId: linkedAssignmentId,
    userId: user.id,
    input: isClosingStaleSession
      ? {
          ...input,
          comment: appendClockInComment(input.comment, 'Fermeture de session ancienne.'),
        }
      : input,
    distanceKm: 0,
    status: ClockInStatus.VALID,
    isRegularized: isClosingStaleSession,
  });

  return Response.json({ record });
});

function parseOfficeLocationId(body: unknown) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const value = (body as Record<string, unknown>).officeLocationId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePlanningAssignmentId(body: unknown) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const value = (body as Record<string, unknown>).planningAssignmentId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseOfficeClockInLocation(body: unknown) {
  if (!body || typeof body !== 'object') {
    return OfficeClockInLocation.OFFICE;
  }

  const value = (body as Record<string, unknown>).officeClockInLocation;
  if (value === undefined || value === null || value === '') {
    return OfficeClockInLocation.OFFICE;
  }

  return value === OfficeClockInLocation.OFFICE || value === OfficeClockInLocation.PROFESSIONAL_TRAVEL
    ? value
    : null;
}

function parseProfessionalTravelDetails(body: unknown) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const record = body as Record<string, unknown>;
  const actualZone = sanitizeText(record.travelActualZone);
  const specificPlace = sanitizeText(record.travelSpecificPlace);
  const reason = sanitizeText(record.travelReason);
  const comment = sanitizeText(record.travelComment);

  if (!actualZone || !reason) {
    return null;
  }

  return { actualZone, specificPlace, reason, comment };
}

function sanitizeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;
}

function buildProfessionalTravelComment({
  actualZone,
  specificPlace,
  reason,
  comment,
}: {
  actualZone: string;
  specificPlace: string | null;
  reason: string;
  comment: string | null;
}) {
  const lines = [`Ville / zone reelle : ${actualZone}`, `Motif : ${reason}`];

  if (specificPlace) {
    lines.push(`Lieu precis : ${specificPlace}`);
  }

  if (comment) {
    lines.push(`Commentaire : ${comment}`);
  }

  return lines.join('\n');
}

async function validateOfficePlanningAssignment(userId: string, assignmentId: string | null, timestampLocal: string) {
  if (!assignmentId) {
    return { ok: true as const, assignmentId: null };
  }

  const date = new Date(timestampLocal);
  const day = new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const assignment = await prisma.planningAssignment.findFirst({
    where: {
      id: assignmentId,
      supervisorId: userId,
      date: day,
      deletedAt: null,
      workLocationType: PlanningWorkLocationType.OFFICE,
    },
    select: { id: true },
  });

  if (!assignment) {
    return { ok: false as const, message: 'Tache bureau introuvable ou non accessible.' };
  }

  return { ok: true as const, assignmentId: assignment.id };
}

function appendClockInComment(existing: string | null | undefined, note: string) {
  const trimmed = existing?.trim();
  return trimmed ? `${note}\n${trimmed}` : note;
}
