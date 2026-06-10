import { ClockInStatus, ClockInType, Role } from '@prisma/client';
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

export const POST = withAuth(async ({ req, user }) => {
  if (user.role === Role.EXTERNAL_RESOURCE) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Acces refuse au pointage bureau.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseClockInInput(body);

  if (!input) {
    return jsonClockInError('BAD_REQUEST', 400, 'Payload de pointage bureau invalide.');
  }

  const gpsError = getClockInGpsValidationError(input);
  if (gpsError) {
    return jsonClockInError('GPS_SPOOFING_SUSPECTED', 400, gpsError);
  }

  const openSession = await getOpenSessionForUser(prisma, user.id);
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
    userId: user.id,
    input,
    distanceKm: 0,
    status: ClockInStatus.VALID,
  });

  return Response.json({ record });
});
