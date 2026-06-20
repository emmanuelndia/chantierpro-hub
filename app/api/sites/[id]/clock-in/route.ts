import { ClockInStatus, ClockInType, UserNotificationAudience, type Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createUserNotification } from '@/lib/notifications';
import {
  buildOutsideGeofenceMessage,
  calculateDistanceToSite,
  createClockInRecord,
  getClockInGpsValidationError,
  getActivePause,
  getAccessibleClockInSite,
  getClockInHistoryForSiteAndUser,
  getOpenSessionForUser,
  isTechnician,
  isWithinSiteGeofence,
  jsonClockInError,
  parseClockInInput,
  parseJsonBody,
  serializeClockInHistory,
  serializeOpenSessionError,
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

  const body = await parseJsonBody<unknown>(req);
  const input = parseClockInInput(body);

  if (!input) {
    return jsonClockInError('BAD_REQUEST', 400, 'Le payload de pointage est invalide.');
  }

  const gpsValidationError = getClockInGpsValidationError(input);

  if (gpsValidationError) {
    return jsonClockInError('GPS_SPOOFING_SUSPECTED', 400, gpsValidationError);
  }

  const accessibleSite = await getAccessibleClockInSite(prisma, params.id, user.id);
  const openSession = await getOpenSessionForUser(prisma, user.id);
  const fallbackSite =
    accessibleSite || input.type === ClockInType.ARRIVAL || openSession?.siteId === params.id
      ? await getClockInSiteWithProject(params.id)
      : null;
  const site = accessibleSite ?? fallbackSite;

  if (!site) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Ce role terrain ne peut pas pointer sur ce chantier.',
    );
  }

  const isOutOfPlanningArrival = !accessibleSite && input.type === ClockInType.ARRIVAL;
  const closingCurrentSiteSession =
    input.type !== ClockInType.ARRIVAL && openSession?.siteId === site.id;

  if (site.status !== 'ACTIVE' && !closingCurrentSiteSession) {
    return jsonClockInError('SITE_INACTIVE', 400, 'Ce chantier est inactif.');
  }

  if (!site.requiresClockIn && !closingCurrentSiteSession) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      400,
      'Ce lieu ne demande pas de pointage GPS.',
    );
  }

  if (input.type === 'ARRIVAL' && openSession) {
    if (openSession.siteId !== site.id) {
      const openContextName = openSession.site?.name ?? openSession.freeMission?.action ?? 'une mission libre';
      return jsonClockInError(
        'SESSION_ALREADY_OPEN',
        409,
        `Session ouverte sur ${openContextName} depuis ${formatTime(openSession.timestampLocal)}. Pointez votre sortie avant de changer de chantier.`,
        {
          openSession: serializeOpenSessionError(openSession),
        },
      );
    }

    return jsonClockInError(
      'SESSION_ALREADY_OPEN',
      400,
      'Une session est deja ouverte sur ce chantier.',
      { openSession: serializeOpenSessionError(openSession) },
    );
  }

  if (
    (input.type === 'DEPARTURE' || input.type === 'INTERMEDIATE') &&
    openSession?.siteId !== site.id
  ) {
    return jsonClockInError(
      'NO_OPEN_SESSION',
      400,
      "Aucune arrivee valide n'est ouverte sur ce chantier.",
    );
  }

  const activePause = await getActivePause(prisma, site.id, user.id);

  if (input.type === 'PAUSE_START' && openSession?.siteId !== site.id) {
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
  const withinGeofence = isWithinSiteGeofence(site, input, distanceKm);

  if (isOutOfPlanningArrival) {
    const taskText = sanitizeOutOfPlanningTask(input.comment);

    if (!taskText) {
      return jsonClockInError(
        'BAD_REQUEST',
        400,
        'Renseignez les taches a effectuer pour ce pointage hors planning.',
      );
    }

    if (!withinGeofence) {
      return jsonClockInError(
        'OUTSIDE_RADIUS',
        400,
        buildOutsideGeofenceMessage(distanceKm, site),
        { distanceKm },
      );
    }

    const record = await createClockInRecord(prisma, {
      siteId: site.id,
      userId: user.id,
      input: {
        ...input,
        comment: buildOutOfPlanningComment(taskText),
      },
      distanceKm,
      status: ClockInStatus.VALID,
      isRemoteCheckout: false,
    });

    if (fallbackSite?.project.projectManagerId) {
      await notifyProjectManagerOfOutOfPlanningClockIn({
        projectManagerId: fallbackSite.project.projectManagerId,
        siteName: site.name,
        taskText,
        user,
      });
    }

    return Response.json({ record, outOfPlanning: true }, { status: 201 });
  }

  const remoteDepartureAllowed =
    input.type === ClockInType.DEPARTURE &&
    !withinGeofence &&
    openSession?.siteId === site.id;
  const status = withinGeofence || remoteDepartureAllowed ? ClockInStatus.VALID : ClockInStatus.REJECTED;
  const recordInput = remoteDepartureAllowed
    ? {
        ...input,
        comment: appendClockInComment(
          input.comment,
          'Sortie distante autorisee - fermeture de session hors zone.',
        ),
      }
    : input;

  const record = await createClockInRecord(prisma, {
      siteId: site.id,
      userId: user.id,
      input: recordInput,
      distanceKm,
      status,
      isRemoteCheckout: remoteDepartureAllowed,
    });

  if (!withinGeofence && !remoteDepartureAllowed) {
    return jsonClockInError(
      'OUTSIDE_RADIUS',
      400,
      buildOutsideGeofenceMessage(distanceKm, site),
      {
        distanceKm,
        record,
      },
    );
  }

  return Response.json({ record }, { status: 201 });
});

function appendClockInComment(existing: string | null | undefined, note: string) {
  const trimmed = existing?.trim();
  return trimmed ? `${note}\n${trimmed}` : note;
}

async function getClockInSiteWithProject(siteId: string) {
  return prisma.site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      name: true,
      status: true,
      requiresClockIn: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      geofenceType: true,
      geofencePolygon: true,
      project: {
        select: {
          projectManagerId: true,
        },
      },
    },
  });
}

function sanitizeOutOfPlanningTask(value: string | null | undefined) {
  const text = value?.trim().replace(/\s+/g, ' ');
  if (!text || text.length < 3) return null;
  return text.slice(0, 500);
}

function buildOutOfPlanningComment(taskText: string) {
  return [
    'Pointage hors planning',
    `Taches prevues : ${taskText}`,
    'Validation PM : en attente',
  ].join('\n');
}

async function notifyProjectManagerOfOutOfPlanningClockIn({
  projectManagerId,
  siteName,
  taskText,
  user,
}: {
  projectManagerId: string;
  siteName: string;
  taskText: string;
  user: { id: string; role: Role };
}) {
  if (!projectManagerId || projectManagerId === user.id) {
    return;
  }

  await createUserNotification(prisma, user, {
    title: 'Pointage hors planning',
    message: `Une ressource a pointe hors planning sur ${siteName}. Taches declarees : ${taskText}`,
    audience: UserNotificationAudience.USERS,
    userIds: [projectManagerId],
  });
}

function formatTime(value: Date) {
  return value.toISOString().slice(11, 16);
}
