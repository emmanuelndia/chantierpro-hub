import { ClockInStatus } from '@prisma/client';
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
  const status = withinRadius ? ClockInStatus.VALID : ClockInStatus.REJECTED;

  const record = await createClockInRecord(prisma, {
    siteId: site.id,
    userId: user.id,
    input,
    distanceKm,
    status,
  });

  if (!withinRadius) {
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
