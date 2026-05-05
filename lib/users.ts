import { randomInt } from 'node:crypto';
import { Prisma, Role, type PrismaClient } from '@prisma/client';
import { PASSWORD_RESET_DEFAULT } from '@/lib/auth/constants';
import { hashPassword, isStrongPassword, verifyPassword } from '@/lib/auth/password';
import type {
  CreateUserResponse,
  PaginatedUsersResponse,
  UserApiErrorCode,
  UserDetail,
  UserListItem,
} from '@/types/users';

export const USERS_PAGE_SIZE = 15;

const TEMP_PASSWORD_UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TEMP_PASSWORD_LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const TEMP_PASSWORD_DIGITS = '23456789';
const TEMP_PASSWORD_ALPHABET =
  TEMP_PASSWORD_UPPERCASE + TEMP_PASSWORD_LOWERCASE + TEMP_PASSWORD_DIGITS;

export const userPublicSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  contact: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type SerializableUser = Prisma.UserGetPayload<{
  select: typeof userPublicSelect;
}>;

export type CreateUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  contact: string;
};

export type UpdateUserInput = {
  firstName: string;
  lastName: string;
  role: Role;
  contact: string;
};

export type UserListQuery = {
  page: number;
  role: Role | null;
  status: 'active' | 'inactive' | 'all';
  search: string | null;
};

export type UpdateOwnProfileInput = {
  firstName: string;
  lastName: string;
};

export type UpdateUserStatusInput = {
  isActive: boolean;
};

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export function jsonUserError(
  code: UserApiErrorCode,
  status: number,
  message: string,
  extra?: Record<string, boolean | number | string>,
) {
  return Response.json(
    {
      code,
      message,
      ...extra,
    },
    { status },
  );
}

export function serializeUser(user: SerializableUser): UserListItem {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    contact: user.contact,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function serializeUserDetail(user: SerializableUser): UserDetail {
  return serializeUser(user);
}

export function serializePaginatedUsers(payload: {
  items: SerializableUser[];
  page: number;
  totalItems: number;
}): PaginatedUsersResponse {
  return {
    items: payload.items.map(serializeUser),
    page: payload.page,
    pageSize: USERS_PAGE_SIZE,
    totalItems: payload.totalItems,
    totalPages: Math.max(1, Math.ceil(payload.totalItems / USERS_PAGE_SIZE)),
  };
}

export function parsePage(searchParams: URLSearchParams) {
  const rawPage = searchParams.get('page');
  const page = Number(rawPage ?? '1');

  if (!Number.isInteger(page) || page < 1) {
    return null;
  }

  return page;
}

export function parseUserListQuery(searchParams: URLSearchParams): UserListQuery | null {
  const page = parsePage(searchParams);
  const role = parseOptionalRole(searchParams.get('role'));
  const status = parseUserStatus(searchParams.get('status'));
  const search = sanitizeOptionalString(searchParams.get('search'));

  if (!page || role === undefined || status === null) {
    return null;
  }

  return {
    page,
    role,
    status,
    search,
  };
}

export function buildUserListWhere(query: UserListQuery): Prisma.UserWhereInput {
  return {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status === 'active' ? { isActive: true } : {}),
    ...(query.status === 'inactive' ? { isActive: false } : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function parseCreateUserInput(body: unknown): CreateUserInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const role = parseRole(body.role);
  const email = sanitizeEmail(body.email);
  const firstName = sanitizeString(body.firstName);
  const lastName = sanitizeString(body.lastName);
  const contact = sanitizeOptionalString(body.contact) ?? '';

  if (!role || !email || !firstName || !lastName) {
    return null;
  }

  return {
    email,
    firstName,
    lastName,
    role,
    contact,
  };
}

export function parseUpdateUserInput(body: unknown): UpdateUserInput | null {
  if (!isRecord(body) || 'email' in body || 'isActive' in body) {
    return null;
  }

  const role = parseRole(body.role);
  const firstName = sanitizeString(body.firstName);
  const lastName = sanitizeString(body.lastName);
  const contact = sanitizeOptionalString(body.contact) ?? '';

  if (!role || !firstName || !lastName) {
    return null;
  }

  return {
    firstName,
    lastName,
    role,
    contact,
  };
}

export function parseUpdateOwnProfileInput(body: unknown): UpdateOwnProfileInput | null {
  if (
    !isRecord(body) ||
    'email' in body ||
    'role' in body ||
    'isActive' in body ||
    'contact' in body ||
    'mustChangePassword' in body
  ) {
    return null;
  }

  const firstName = sanitizeString(body.firstName);
  const lastName = sanitizeString(body.lastName);

  if (!firstName || !lastName) {
    return null;
  }

  return {
    firstName,
    lastName,
  };
}

export function parseUpdateUserStatusInput(body: unknown): UpdateUserStatusInput | null {
  if (!isRecord(body) || typeof body.isActive !== 'boolean') {
    return null;
  }

  return {
    isActive: body.isActive,
  };
}

export function parseChangePasswordInput(body: unknown): ChangePasswordInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const currentPassword = sanitizeString(body.currentPassword);
  const newPassword = sanitizeString(body.newPassword);

  if (!currentPassword || !newPassword) {
    return null;
  }

  return {
    currentPassword,
    newPassword,
  };
}

export function validateImmutableEmail(body: unknown) {
  return isRecord(body) && 'email' in body;
}

export async function revokeUserSessions(prisma: PrismaClient, userId: string) {
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function getUserByIdOrNull(prisma: PrismaClient, userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: userPublicSelect,
  });
}

export function generateTemporaryPassword() {
  const characters = [
    pickRandom(TEMP_PASSWORD_UPPERCASE),
    pickRandom(TEMP_PASSWORD_LOWERCASE),
    pickRandom(TEMP_PASSWORD_DIGITS),
  ];

  while (characters.length < 12) {
    characters.push(pickRandom(TEMP_PASSWORD_ALPHABET));
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = characters[index] ?? 'A';
    characters[index] = characters[swapIndex] ?? current;
    characters[swapIndex] = current;
  }

  return characters.join('');
}

export async function createManagedUser(
  prisma: PrismaClient,
  input: CreateUserInput,
): Promise<CreateUserResponse> {
  const temporaryPassword = PASSWORD_RESET_DEFAULT;
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      contact: input.contact,
      passwordHash,
      isActive: true,
      mustChangePassword: true,
    },
    select: userPublicSelect,
  });

  return {
    user: serializeUserDetail(user),
    temporaryPassword,
  };
}

export async function verifyAndValidatePasswordChange(
  prisma: PrismaClient,
  userId: string,
  input: ChangePasswordInput,
) {
  if (!isStrongPassword(input.newPassword)) {
    return jsonUserError(
      'INVALID_PASSWORD',
      400,
      'Le nouveau mot de passe doit contenir au moins 8 caracteres, 1 majuscule et 1 chiffre.',
    );
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
    },
  });

  if (!currentUser) {
    return jsonUserError('NOT_FOUND', 404, 'Utilisateur introuvable.');
  }

  const passwordMatches = await verifyPassword(input.currentPassword, currentUser.passwordHash);

  if (!passwordMatches) {
    return jsonUserError(
      'INVALID_CURRENT_PASSWORD',
      400,
      'Le mot de passe actuel est incorrect.',
    );
  }

  return null;
}

function sanitizeEmail(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim().toLowerCase();

  if (!email.includes('@')) {
    return null;
  }

  return email;
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseRole(value: unknown) {
  return typeof value === 'string' && Object.values(Role).includes(value as Role)
    ? (value as Role)
    : null;
}

function parseOptionalRole(value: string | null) {
  if (!value || value === 'ALL') {
    return null;
  }

  return Object.values(Role).includes(value as Role) ? (value as Role) : undefined;
}

function parseUserStatus(value: string | null): UserListQuery['status'] | null {
  if (!value || value === 'all') {
    return 'all';
  }

  return value === 'active' || value === 'inactive' ? value : null;
}

function sanitizeOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  return sanitizeString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pickRandom(characters: string) {
  return characters[randomInt(characters.length)] ?? characters[0] ?? 'A';
}
