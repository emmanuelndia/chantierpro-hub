import { Prisma, Role, type PrismaClient } from '@prisma/client';
import type { OfficeLocationItem, OfficeLocationPayload } from '@/types/office-locations';

const officeLocationSelect = {
  id: true,
  name: true,
  address: true,
  city: true,
  latitude: true,
  longitude: true,
  radiusKm: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.OfficeLocationSelect;

type SerializableOfficeLocation = Prisma.OfficeLocationGetPayload<{ select: typeof officeLocationSelect }>;

export function canManageOfficeLocations(role: Role) {
  return role === Role.ADMIN;
}

export function canUseOfficeClockIn(role: Role) {
  return role !== Role.EXTERNAL_RESOURCE;
}

export function parseOfficeLocationPayload(body: unknown): OfficeLocationPayload | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const input = body as Record<string, unknown>;
  const name = sanitizeString(input.name);
  const address = sanitizeString(input.address);
  const city = sanitizeString(input.city);
  const latitude = parseCoordinate(input.latitude, -90, 90);
  const longitude = parseCoordinate(input.longitude, -180, 180);
  const radiusKm = parseRadius(input.radiusKm);
  const isActive = typeof input.isActive === 'boolean' ? input.isActive : true;

  if (!name || !address || latitude === null || longitude === null || radiusKm === null) {
    return null;
  }

  return {
    name,
    address,
    city,
    latitude,
    longitude,
    radiusKm,
    isActive,
  };
}

export async function listOfficeLocations(prisma: PrismaClient, activeOnly = false) {
  const items = await prisma.officeLocation.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    select: officeLocationSelect,
  });

  return {
    items: items.map(serializeOfficeLocation),
  };
}

export async function createOfficeLocation(
  prisma: PrismaClient,
  payload: OfficeLocationPayload & { createdById: string },
) {
  const item = await prisma.officeLocation.create({
    data: {
      name: payload.name,
      address: payload.address,
      city: payload.city ?? null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      radiusKm: payload.radiusKm,
      isActive: payload.isActive ?? true,
      createdById: payload.createdById,
    },
    select: officeLocationSelect,
  });

  return serializeOfficeLocation(item);
}

export async function updateOfficeLocation(
  prisma: PrismaClient,
  id: string,
  payload: OfficeLocationPayload,
) {
  const item = await prisma.officeLocation.update({
    where: { id },
    data: {
      name: payload.name,
      address: payload.address,
      city: payload.city ?? null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      radiusKm: payload.radiusKm,
      isActive: payload.isActive ?? true,
    },
    select: officeLocationSelect,
  });

  return serializeOfficeLocation(item);
}

export async function getActiveOfficeLocation(prisma: PrismaClient, id: string) {
  return prisma.officeLocation.findFirst({
    where: { id, isActive: true },
    select: officeLocationSelect,
  });
}

function serializeOfficeLocation(item: SerializableOfficeLocation): OfficeLocationItem {
  return {
    id: item.id,
    name: item.name,
    address: item.address,
    city: item.city,
    latitude: item.latitude.toNumber(),
    longitude: item.longitude.toNumber(),
    radiusKm: item.radiusKm.toNumber(),
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
  };
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCoordinate(value: unknown, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function parseRadius(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 50 ? parsed : null;
}
