import { ClockInStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { notifyClockInSyncAnomaly } from '@/lib/mobile-sync-notifications';
import {
  buildBatchResult,
  buildOutsideGeofenceMessage,
  calculateDistanceToSite,
  createBatchClockInRecord,
  getClockInGpsValidationError,
  getActivePause,
  getAccessibleClockInSite,
  getOpenSessionForUser,
  isTechnician,
  isWithinSiteGeofence,
  jsonClockInError,
  parseBatchSyncInput,
  parseJsonBody,
} from '@/lib/clock-in';
import type { BatchSyncItemInput, BatchSyncItemResult, ClockInApiErrorCode } from '@/types/clock-in';

type SessionState = {
  openSiteId: string | null;
  openSiteName: string | null;
  hasOpenSession: boolean;
  hasActivePause: boolean;
};

export const POST = withAuth(async ({ req, user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Seuls les roles terrain peuvent synchroniser.');
  }

  const body = await parseJsonBody<unknown>(req);
  const items = parseBatchSyncInput(body);

  if (!items) {
    return jsonClockInError('BAD_REQUEST', 400, 'Le payload de synchronisation est invalide.');
  }

  const results: BatchSyncItemResult[] = [];
  const sortedItems = [...items].sort(
    (left, right) =>
      new Date(left.timestampLocal).getTime() - new Date(right.timestampLocal).getTime(),
  );
  const sessionStates = new Map<string, SessionState>();

  for (const item of sortedItems) {
    const result = await processBatchItem({
      item,
      sessionStates,
      userId: user.id,
    });
    results.push(buildBatchResult(result));
  }

  return Response.json({ items: results });
});

async function processBatchItem(payload: {
  item: BatchSyncItemInput;
  sessionStates: Map<string, SessionState>;
  userId: string;
}): Promise<BatchSyncItemResult> {
  const site = await getAccessibleClockInSite(prisma, payload.item.siteId, payload.userId);

  if (!site) {
    return buildErrorResult(payload.item, ClockInStatus.ANOMALY, 'PERMISSION_DENIED', false, {
      message: 'Ce role terrain ne peut pas synchroniser ce chantier.',
    });
  }

  if (site.status !== 'ACTIVE') {
    return buildErrorResult(payload.item, ClockInStatus.ANOMALY, 'SITE_INACTIVE', false, {
      message: 'Ce chantier est inactif.',
    });
  }

  if (!site.requiresClockIn) {
    return buildErrorResult(payload.item, ClockInStatus.ANOMALY, 'PERMISSION_DENIED', false, {
      message: 'Ce lieu ne demande pas de pointage GPS.',
    });
  }

  const gpsValidationError = getClockInGpsValidationError(payload.item);

  if (gpsValidationError) {
    const anomaly = await createBatchClockInRecord(prisma, {
      siteId: site.id,
      userId: payload.userId,
      input: payload.item,
      distanceKm: 0,
      status: ClockInStatus.ANOMALY,
    });

    return buildErrorResult(payload.item, ClockInStatus.ANOMALY, 'GPS_SPOOFING_SUSPECTED', false, {
      message: gpsValidationError,
      recordId: anomaly.id,
    });
  }

  const distanceKm = calculateDistanceToSite(site, payload.item);
  const withinGeofence = isWithinSiteGeofence(site, payload.item, distanceKm);
  const sessionState = await getOrLoadSessionState(
    payload.sessionStates,
    payload.userId,
  );

  if (payload.item.type === 'ARRIVAL' && sessionState.hasOpenSession) {
    const anomaly = await createBatchClockInRecord(prisma, {
      siteId: site.id,
      userId: payload.userId,
      input: payload.item,
      distanceKm,
      status: ClockInStatus.ANOMALY,
    });

    return buildErrorResult(
      payload.item,
      ClockInStatus.ANOMALY,
        'SESSION_ALREADY_OPEN',
        false,
        {
        message: sessionState.openSiteName
          ? `Session ouverte sur ${sessionState.openSiteName}. Pointez votre sortie avant de changer de chantier.`
          : 'Une session est deja ouverte.',
        recordId: anomaly.id,
      },
    );
  }

  if (
    payload.item.type === 'DEPARTURE' &&
    (!sessionState.hasOpenSession || sessionState.openSiteId !== payload.item.siteId)
  ) {
    const anomaly = await createBatchClockInRecord(prisma, {
      siteId: site.id,
      userId: payload.userId,
      input: payload.item,
      distanceKm,
      status: ClockInStatus.ANOMALY,
    });

    await notifyClockInSyncAnomaly(prisma, {
      siteId: site.id,
      userId: payload.userId,
      type: payload.item.type,
      errorCode: 'DEPARTURE_BEFORE_ARRIVAL',
      message: "Une sortie synchronisee precede l'arrivee.",
      recordId: anomaly.id,
    });

    return buildErrorResult(payload.item, ClockInStatus.ANOMALY, 'DEPARTURE_BEFORE_ARRIVAL', false, {
      message: "Une sortie synchronisee precede l'arrivee.",
      recordId: anomaly.id,
    });
  }

  if (
    payload.item.type === 'INTERMEDIATE' &&
    (!sessionState.hasOpenSession || sessionState.openSiteId !== payload.item.siteId)
  ) {
    const anomaly = await createBatchClockInRecord(prisma, {
      siteId: site.id,
      userId: payload.userId,
      input: payload.item,
      distanceKm,
      status: ClockInStatus.ANOMALY,
    });

    return buildErrorResult(payload.item, ClockInStatus.ANOMALY, 'NO_OPEN_SESSION', false, {
      message: "Aucune arrivee valide n'est ouverte sur ce chantier.",
      recordId: anomaly.id,
    });
  }

  if (
    payload.item.type === 'PAUSE_START' &&
    (!sessionState.hasOpenSession || sessionState.openSiteId !== payload.item.siteId)
  ) {
    const anomaly = await createBatchClockInRecord(prisma, {
      siteId: site.id,
      userId: payload.userId,
      input: payload.item,
      distanceKm,
      status: ClockInStatus.ANOMALY,
    });

    return buildErrorResult(payload.item, ClockInStatus.ANOMALY, 'NO_OPEN_SESSION', false, {
      message: "Aucune arrivee valide n'est ouverte sur ce chantier.",
      recordId: anomaly.id,
    });
  }

  if (payload.item.type === 'PAUSE_START' && sessionState.hasActivePause) {
    const anomaly = await createBatchClockInRecord(prisma, {
      siteId: site.id,
      userId: payload.userId,
      input: payload.item,
      distanceKm,
      status: ClockInStatus.ANOMALY,
    });

    return buildErrorResult(
      payload.item,
      ClockInStatus.ANOMALY,
      'PAUSE_ALREADY_ACTIVE',
      false,
      {
        message: 'Une pause est deja active sur ce chantier.',
        recordId: anomaly.id,
      },
    );
  }

  if (payload.item.type === 'PAUSE_END' && !sessionState.hasActivePause) {
    const anomaly = await createBatchClockInRecord(prisma, {
      siteId: site.id,
      userId: payload.userId,
      input: payload.item,
      distanceKm,
      status: ClockInStatus.ANOMALY,
    });

    await notifyClockInSyncAnomaly(prisma, {
      siteId: site.id,
      userId: payload.userId,
      type: payload.item.type,
      errorCode: 'PAUSE_END_BEFORE_PAUSE_START',
      message: 'Une reprise synchronisee precede la pause.',
      recordId: anomaly.id,
    });

    return buildErrorResult(payload.item, ClockInStatus.ANOMALY, 'PAUSE_END_BEFORE_PAUSE_START', false, {
      message: 'Une reprise synchronisee precede la pause.',
      recordId: anomaly.id,
    });
  }

  const remoteCheckoutSite =
    payload.item.type === 'DEPARTURE' && !withinGeofence
      ? await findRemoteCheckoutTarget(site.id, payload.userId, payload.item)
      : null;
  const remoteCheckoutAllowed = Boolean(remoteCheckoutSite);

  if (!withinGeofence && !remoteCheckoutAllowed) {
    const rejected = await createBatchClockInRecord(prisma, {
      siteId: site.id,
      userId: payload.userId,
      input: payload.item,
      distanceKm,
      status: ClockInStatus.REJECTED,
    });

    return buildErrorResult(payload.item, ClockInStatus.REJECTED, 'OUTSIDE_RADIUS', false, {
      message: buildOutsideGeofenceMessage(distanceKm, site),
      recordId: rejected.id,
    });
  }

  const created = await createBatchClockInRecord(prisma, {
    siteId: site.id,
    userId: payload.userId,
    input: payload.item,
    distanceKm,
    status: ClockInStatus.VALID,
    isRemoteCheckout: remoteCheckoutAllowed,
  });

  if (payload.item.type === 'ARRIVAL') {
    sessionState.hasOpenSession = true;
    sessionState.openSiteId = payload.item.siteId;
    sessionState.openSiteName = site.name;
  } else if (payload.item.type === 'DEPARTURE') {
    sessionState.hasOpenSession = false;
    sessionState.openSiteId = null;
    sessionState.openSiteName = null;
    sessionState.hasActivePause = false;
  } else if (payload.item.type === 'PAUSE_START') {
    sessionState.hasActivePause = true;
  } else if (payload.item.type === 'PAUSE_END') {
    sessionState.hasActivePause = false;
  }

  return {
    siteId: payload.item.siteId,
    type: payload.item.type,
    timestampLocal: payload.item.timestampLocal,
    accepted: true,
    status: ClockInStatus.VALID,
    recordId: created.id,
  };
}

async function findRemoteCheckoutTarget(
  siteId: string,
  userId: string,
  input: Pick<BatchSyncItemInput, 'latitude' | 'longitude' | 'timestampLocal'>,
) {
  const clockInDate = new Date(`${new Date(input.timestampLocal).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const assignments = await prisma.planningAssignment.findMany({
    where: {
      supervisorId: userId,
      date: clockInDate,
      deletedAt: null,
      workLocationType: 'ON_SITE',
      siteId: {
        not: siteId,
      },
      site: {
        requiresClockIn: true,
      },
    },
    select: {
      site: {
        select: {
          id: true,
          requiresClockIn: true,
          latitude: true,
          longitude: true,
          radiusKm: true,
          geofenceType: true,
          geofencePolygon: true,
        },
      },
    },
  });

  return assignments.find((assignment) => {
    const distance = calculateDistanceToSite(assignment.site, input);
    return isWithinSiteGeofence(assignment.site, input, distance);
  })?.site ?? null;
}

async function getOrLoadSessionState(
  states: Map<string, SessionState>,
  userId: string,
) {
  const cacheKey = userId;
  const cached = states.get(cacheKey);

  if (cached) {
    return cached;
  }

  const openSession = await getOpenSessionForUser(prisma, userId);
  const activePause = openSession ? await getActivePause(prisma, openSession.siteId, userId) : null;
  const state = {
    openSiteId: openSession?.siteId ?? null,
    openSiteName: openSession?.site.name ?? null,
    hasOpenSession: Boolean(openSession),
    hasActivePause: Boolean(activePause),
  };

  states.set(cacheKey, state);
  return state;
}

function buildErrorResult(
  item: BatchSyncItemInput,
  status: ClockInStatus,
  errorCode: ClockInApiErrorCode,
  accepted: boolean,
  extra?: {
    message?: string;
    recordId?: string;
  },
): BatchSyncItemResult {
  const result: BatchSyncItemResult = {
    siteId: item.siteId,
    type: item.type,
    timestampLocal: item.timestampLocal,
    accepted,
    status,
    errorCode,
  };

  if (extra?.message) {
    result.message = extra.message;
  }

  if (extra?.recordId) {
    result.recordId = extra.recordId;
  }

  return result;
}
