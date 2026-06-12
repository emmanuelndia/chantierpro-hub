import { ClockInStatus, ClockInType, PlanningWorkLocationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createClockInRecord,
  findActivePauseFromRecords,
  getClockInGpsValidationError,
  getOpenSessionForUser,
  jsonClockInError,
  parseClockInInput,
  parseJsonBody,
} from '@/lib/clock-in';
import { withAuth } from '@/lib/auth/with-auth';
import { haversineDistanceKm } from '@/lib/haversine';
import { getActiveOfficeLocation } from '@/lib/office-locations';

export const POST = withAuth(async ({ req, user }) => {
  const body = await parseJsonBody<unknown>(req);
  const input = parseClockInInput(body);
  const officeLocationId = parseOfficeLocationId(body);
  const requestedPlanningAssignmentId = parsePlanningAssignmentId(body);

  if (!input || (input.type === ClockInType.ARRIVAL && !officeLocationId)) {
    return jsonClockInError('BAD_REQUEST', 400, 'Payload de pointage bureau invalide.');
  }

  const gpsError = getClockInGpsValidationError(input);
  if (gpsError) {
    return jsonClockInError('GPS_SPOOFING_SUSPECTED', 400, gpsError);
  }

  const openSession = await getOpenSessionForUser(prisma, user.id);
  const officeLocation =
    input.type === ClockInType.ARRIVAL
      ? await getActiveOfficeLocation(prisma, officeLocationId!)
      : openSession?.officeLocationId
        ? await getActiveOfficeLocation(prisma, openSession.officeLocationId)
        : null;

  if (!officeLocation) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Bureau introuvable ou inactif.');
  }

  if (input.type === ClockInType.ARRIVAL && openSession) {
    return jsonClockInError('SESSION_ALREADY_OPEN', 409, 'Une session de pointage est deja ouverte.');
  }

  if (input.type !== ClockInType.ARRIVAL) {
    if (!openSession) {
      return jsonClockInError('NO_OPEN_SESSION', 400, 'Aucune session bureau ouverte.');
    }

    if (openSession.officeClockInLocation !== 'OFFICE') {
      return jsonClockInError('PERMISSION_DENIED', 400, 'La session ouverte ne concerne pas le bureau.');
    }
  }

  if (input.type === ClockInType.ARRIVAL) {
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
        officeClockInLocation: 'OFFICE',
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

  const record = await createClockInRecord(prisma, {
    officeClockInLocation: 'OFFICE',
    officeLocationId: officeLocation.id,
    planningAssignmentId: linkedAssignmentId,
    userId: user.id,
    input,
    distanceKm: 0,
    status: ClockInStatus.VALID,
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
