import { ClockInStatus, ClockInType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { jsonRhError } from '@/lib/rh';

export const POST = withAuth(async ({ req, user }) => {
  if (user.role !== Role.ADMIN) {
    return jsonRhError('FORBIDDEN', 403, 'Seul un administrateur peut fermer une sortie oubliee.');
  }

  const body = (await req.json().catch((): unknown => null)) as unknown;
  if (!isRecord(body) || typeof body.arrivalRecordId !== 'string') {
    return jsonRhError('BAD_REQUEST', 400, 'Pointage entree obligatoire.');
  }

  const arrival = await prisma.clockInRecord.findFirst({
    where: {
      id: body.arrivalRecordId,
      type: ClockInType.ARRIVAL,
      status: ClockInStatus.VALID,
    },
  });

  if (!arrival) {
    return jsonRhError('NOT_FOUND', 404, 'Session ouverte introuvable.');
  }

  const existingDeparture = await prisma.clockInRecord.findFirst({
    where: {
      userId: arrival.userId,
      siteId: arrival.siteId,
      freeMissionId: arrival.freeMissionId,
      officeLocationId: arrival.officeLocationId,
      officeClockInLocation: arrival.officeClockInLocation,
      planningAssignmentId: arrival.planningAssignmentId,
      status: ClockInStatus.VALID,
      type: ClockInType.DEPARTURE,
      timestampLocal: { gt: arrival.timestampLocal },
    },
    select: { id: true },
  });

  if (existingDeparture) {
    return jsonRhError('BAD_REQUEST', 400, 'Cette session possede deja une sortie.');
  }

  const closedAt = new Date();
  if (closedAt.getTime() <= arrival.timestampLocal.getTime()) {
    return jsonRhError('BAD_REQUEST', 400, "La sortie doit etre posterieure a l'entree.");
  }

  const comment = 'Sortie fermee par administrateur';
  const departure = await prisma.$transaction(async (tx) => {
    const created = await tx.clockInRecord.create({
      data: {
        siteId: arrival.siteId,
        freeMissionId: arrival.freeMissionId,
        planningAssignmentId: arrival.planningAssignmentId,
        officeLocationId: arrival.officeLocationId,
        officeClockInLocation: arrival.officeClockInLocation,
        userId: arrival.userId,
        type: ClockInType.DEPARTURE,
        clockInDate: new Date(`${closedAt.toISOString().slice(0, 10)}T00:00:00.000Z`),
        clockInTime: closedAt,
        latitude: arrival.latitude,
        longitude: arrival.longitude,
        accuracy: arrival.accuracy,
        distanceToSite: arrival.distanceToSite,
        status: ClockInStatus.VALID,
        comment,
        timestampLocal: closedAt,
        isRemoteCheckout: true,
        isRegularized: true,
      },
      select: { id: true },
    });

    await tx.clockInRecord.update({
      where: { id: arrival.id },
      data: { isRegularized: true },
      select: { id: true },
    });

    await tx.clockInRegularization.create({
      data: {
        clockInRecordId: created.id,
        correctedDepartureTime: closedAt,
        authorId: user.id,
        comment,
      },
    });

    return created;
  });

  return Response.json({ recordId: departure.id }, { status: 201 });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
