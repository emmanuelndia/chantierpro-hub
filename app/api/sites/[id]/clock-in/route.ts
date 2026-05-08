import { ClockInStatus, ClockInType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  buildOutsideRadiusMessage,
  calculateDistanceToSite,
  createClockInRecord,
  getClockInGpsValidationError,
  getActivePause,
  getAccessibleClockInSite,
  getClockInHistoryForSiteAndUser,
  getOpenSession,
  isTechnician,
  isWithinSiteRadius,
  jsonClockInError,
  parseClockInInput,
  parseJsonBody,
  serializeClockInHistory,
} from '@/lib/clock-in';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Seuls les roles terrain peuvent consulter leur pointage chantier.',
    );
  }

  const site = await getAccessibleClockInSite(prisma, params.id, user.id);

  if (!site) {
    return jsonClockInError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const records = await getClockInHistoryForSiteAndUser(prisma, site.id, user.id);
  return Response.json({ items: serializeClockInHistory(records) });
});

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Seuls les roles terrain peuvent pointer.');
  }

  const site = await getAccessibleClockInSite(prisma, params.id, user.id);

  if (!site) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Ce role terrain ne peut pas pointer sur ce chantier.',
    );
  }

  if (site.status !== 'ACTIVE') {
    return jsonClockInError('SITE_INACTIVE', 400, 'Ce chantier est inactif.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseClockInInput(body);

  if (!input) {
    return jsonClockInError('BAD_REQUEST', 400, 'Le payload de pointage est invalide.');
  }

  const gpsValidationError = getClockInGpsValidationError(input);

  if (gpsValidationError) {
    return jsonClockInError('GPS_SPOOFING_SUSPECTED', 400, gpsValidationError);
  }

  const openSession = await getOpenSession(prisma, site.id, user.id);

  if (input.type === 'ARRIVAL' && openSession) {
    return jsonClockInError(
      'SESSION_ALREADY_OPEN',
      400,
      'Une session est deja ouverte sur ce chantier.',
    );
  }

  if ((input.type === 'DEPARTURE' || input.type === 'INTERMEDIATE') && !openSession) {
    return jsonClockInError(
      'NO_OPEN_SESSION',
      400,
      "Aucune arrivee valide n'est ouverte sur ce chantier.",
    );
  }

  const activePause = await getActivePause(prisma, site.id, user.id);

  if (input.type === 'PAUSE_START' && !openSession) {
    return jsonClockInError(
      'NO_OPEN_SESSION',
      400,
      "Aucune arrivee valide n'est ouverte sur ce chantier.",
    );
  }

  if (input.type === 'PAUSE_START' && activePause) {
    return jsonClockInError(
      'PAUSE_ALREADY_ACTIVE',
      400,
      'Une pause est deja active sur ce chantier.',
    );
  }

  if (input.type === 'PAUSE_END' && !activePause) {
    return jsonClockInError(
      'NO_ACTIVE_PAUSE',
      400,
      "Aucune pause active n'est ouverte sur ce chantier.",
    );
  }

  const distanceKm = calculateDistanceToSite(site, input);
  const withinRadius = isWithinSiteRadius(site, distanceKm);
  const remoteDepartureAllowed =
    input.type === ClockInType.DEPARTURE &&
    !withinRadius &&
    (await canCloseSessionRemotely(site.id, user.id, input.timestampLocal));
  const status = withinRadius || remoteDepartureAllowed ? ClockInStatus.VALID : ClockInStatus.REJECTED;
  const recordInput = remoteDepartureAllowed
    ? {
        ...input,
        comment: appendClockInComment(
          input.comment,
          'Sortie distante autorisee - ressource deplacee vers un autre chantier assigne.',
        ),
      }
    : input;

  const record = await createClockInRecord(prisma, {
    siteId: site.id,
    userId: user.id,
    input: recordInput,
    distanceKm,
    status,
  });

  if (!withinRadius && !remoteDepartureAllowed) {
    return jsonClockInError(
      'OUTSIDE_RADIUS',
      400,
      buildOutsideRadiusMessage(distanceKm, site),
      {
        distanceKm,
        record,
      },
    );
  }

  return Response.json({ record }, { status: 201 });
});

async function canCloseSessionRemotely(siteId: string, userId: string, timestampLocal: string) {
  const clockInDate = new Date(`${new Date(timestampLocal).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [otherAssignment, otherRecords] = await Promise.all([
    prisma.planningAssignment.findFirst({
      where: {
        supervisorId: userId,
        date: clockInDate,
        deletedAt: null,
        siteId: {
          not: siteId,
        },
      },
      select: {
        id: true,
      },
    }),
    prisma.clockInRecord.findMany({
      where: {
        userId,
        clockInDate,
        status: ClockInStatus.VALID,
        siteId: {
          not: siteId,
        },
      },
      orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        siteId: true,
        type: true,
      },
    }),
  ]);

  if (otherAssignment) {
    return true;
  }

  const openSites = new Set<string>();
  for (const record of otherRecords) {
    if (record.type === ClockInType.ARRIVAL) {
      openSites.add(record.siteId);
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      openSites.delete(record.siteId);
    }
  }

  return openSites.size > 0;
}

function appendClockInComment(existing: string | null | undefined, note: string) {
  const trimmed = existing?.trim();
  return trimmed ? `${note}\n${trimmed}` : note;
}
