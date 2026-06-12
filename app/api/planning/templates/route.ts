import { PlanningWorkLocationType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';

const allowedRoles: readonly Role[] = [
  Role.GENERAL_SUPERVISOR,
  Role.BE_MANAGER,
  Role.NEGOTIATION_MANAGER,
  Role.FLEET_MANAGER,
  Role.PROJECT_MANAGER,
];

export const GET = withAuth(async ({ user }) => {
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux modeles planning.' }, { status: 403 });
  }

  const items = await prisma.planningTaskTemplate.findMany({
    where: { createdById: user.id },
    orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
    take: 50,
    select: {
      id: true,
      name: true,
      action: true,
      targetProgress: true,
      targetQuantity: true,
      targetUnit: true,
      objectiveText: true,
      plannedDurationMinutes: true,
      workLocationType: true,
      createdAt: true,
    },
  });

  return Response.json({
    items: items.map((item) => ({
      ...item,
      targetQuantity: item.targetQuantity?.toString() ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
  });
});

export const POST = withAuth(async ({ req, user }) => {
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Creation modele planning refusee.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const input = parseTemplateInput(body);
  if (!input) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Modele planning invalide.' }, { status: 400 });
  }

  const created = await prisma.planningTaskTemplate.create({
    data: {
      ...input,
      createdById: user.id,
    },
    select: {
      id: true,
      name: true,
      action: true,
      targetProgress: true,
      targetQuantity: true,
      targetUnit: true,
      objectiveText: true,
      plannedDurationMinutes: true,
      workLocationType: true,
      createdAt: true,
    },
  });

  return Response.json(
    {
      template: {
        ...created,
        targetQuantity: created.targetQuantity?.toString() ?? null,
        createdAt: created.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
});

function parseTemplateInput(value: unknown) {
  if (!isRecord(value)) return null;

  const name = sanitizeText(value.name, 80);
  const action = sanitizeText(value.action, 500);
  const objectiveText = sanitizeText(value.objectiveText, 500);
  const targetUnit = sanitizeText(value.targetUnit, 30);
  const workLocationType = parseWorkLocationType(value.workLocationType);
  const targetQuantity = parseNullablePositiveNumber(value.targetQuantity);
  const plannedDurationMinutes = parseNullableInt(value.plannedDurationMinutes, 0, 24 * 60);
  const targetProgress =
    targetQuantity !== null && targetQuantity > 0 ? null : parseNullableInt(value.targetProgress, 0, 100);

  if (!name || !action || !workLocationType) return null;

  return {
    name,
    action,
    objectiveText,
    targetUnit,
    targetQuantity,
    targetProgress,
    plannedDurationMinutes,
    workLocationType,
  };
}

function parseWorkLocationType(value: unknown) {
  if (
    value === PlanningWorkLocationType.ON_SITE ||
    value === PlanningWorkLocationType.OFFICE ||
    value === PlanningWorkLocationType.FREE_MISSION
  ) {
    return value;
  }
  return null;
}

function parseNullablePositiveNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function parseNullableInt(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= min && numberValue <= max ? numberValue : null;
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
