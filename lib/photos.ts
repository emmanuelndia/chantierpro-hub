import { Buffer } from 'node:buffer';
import { extname } from 'node:path';
import sharp from 'sharp';
import {
  PhotoCategory,
  PhotoTag,
  Prisma,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  generatePhotoStorageKey,
  getSignedPhotoUrlTtlSeconds,
  removePrivatePhotoObject,
  uploadPrivatePhotoObject,
} from '@/lib/photo-storage';
import {
  BUSINESS_FIELD_RESOURCE_ROLES,
  BUSINESS_MANAGER_ROLES,
  FIELD_USER_ROLES,
  getBusinessManagedResourceRoles,
  isBusinessManagerRole,
} from '@/lib/field-roles';
import { generalSupervisorPlanningSiteWhere } from '@/lib/general-supervisor-scopes';
import type {
  AdminDeletionLogItem,
  AdminLogsApiErrorCode,
  AdminLogsExportInput,
  PaginatedAdminDeletionLogsResponse,
} from '@/types/admin-logs';
import type {
  CreatePhotoInput,
  DeletePhotoInput,
  PaginatedPhotoDeletionLogsResponse,
  PaginatedPhotosResponse,
  PhotoApiErrorCode,
  PhotoDeletionLogItem,
  PhotoDetail,
  PhotoSiteOption,
} from '@/types/photos';

const PHOTO_UPLOAD_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.RESOURCE,
  Role.EXTERNAL_RESOURCE,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  ...BUSINESS_MANAGER_ROLES,
  ...BUSINESS_FIELD_RESOURCE_ROLES,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];
const PHOTO_DELETE_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
const PHOTO_LOG_ROLES: readonly Role[] = [Role.DIRECTION, Role.ADMIN];
const ADMIN_LOG_ROLES: readonly Role[] = [Role.DIRECTION, Role.ADMIN];
const PHOTO_SITE_FULL_VIEW_ROLES: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  ...BUSINESS_MANAGER_ROLES,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];
const PHOTO_OWN_ONLY_ROLES: readonly Role[] = [Role.SUPERVISOR, Role.RESOURCE, Role.EXTERNAL_RESOURCE, ...BUSINESS_FIELD_RESOURCE_ROLES];
const MAX_PHOTO_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const COMPRESS_PHOTO_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const PHOTO_PAGE_SIZE = 20;

export const photoSelect = {
  id: true,
  siteId: true,
  freeMissionId: true,
  uploadedById: true,
  planningAssignmentId: true,
  category: true,
  tags: true,
  description: true,
  filename: true,
  storageKey: true,
  fileSize: true,
  format: true,
  latitude: true,
  longitude: true,
  timestampLocal: true,
  takenAt: true,
  isDeleted: true,
  deletedAt: true,
  createdAt: true,
  uploadedBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
  planningAssignment: {
    select: {
      action: true,
      status: true,
    },
  },
  freeMission: {
    select: {
      action: true,
      project: {
        select: {
          id: true,
          name: true,
          projectManagerId: true,
        },
      },
    },
  },
} satisfies Prisma.PhotoSelect;

export const photoDeletionLogSelect = {
  id: true,
  photoId: true,
  deletedById: true,
  originalAuthorId: true,
  reason: true,
  deletedAt: true,
  photo: {
    select: {
      id: true,
      siteId: true,
      freeMissionId: true,
      filename: true,
      category: true,
    },
  },
  deletedBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
  originalAuthor: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
} satisfies Prisma.PhotoDeletionLogSelect;

const adminPhotoDeletionLogSelect = {
  id: true,
  photoId: true,
  reason: true,
  deletedAt: true,
  photo: {
    select: {
      id: true,
      filename: true,
      takenAt: true,
      site: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  deletedBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
  originalAuthor: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
} satisfies Prisma.PhotoDeletionLogSelect;

type SerializablePhoto = Prisma.PhotoGetPayload<{
  select: typeof photoSelect;
}>;

type SerializablePhotoDeletionLog = Prisma.PhotoDeletionLogGetPayload<{
  select: typeof photoDeletionLogSelect;
}>;

type SerializableAdminPhotoDeletionLog = Prisma.PhotoDeletionLogGetPayload<{
  select: typeof adminPhotoDeletionLogSelect;
}>;

type AuthLikeUser = {
  id: string;
  role: Role;
};

export function jsonPhotoError(code: PhotoApiErrorCode, status: number, message: string) {
  return Response.json(
    {
      code,
      message,
    },
    { status },
  );
}

export function canUploadPhotos(role: Role) {
  return PHOTO_UPLOAD_ROLES.includes(role);
}

export function canDeletePhotos(role: Role) {
  return PHOTO_DELETE_ROLES.includes(role);
}

export function canReadPhotoLogs(role: Role) {
  return PHOTO_LOG_ROLES.includes(role);
}

export function canAccessAdminLogs(role: Role) {
  return ADMIN_LOG_ROLES.includes(role);
}

export function canReadAllSitePhotos(role: Role) {
  return PHOTO_SITE_FULL_VIEW_ROLES.includes(role);
}

export function isOwnPhotoOnlyRole(role: Role) {
  return PHOTO_OWN_ONLY_ROLES.includes(role);
}

export async function parseDeletePhotoInput(request: Request): Promise<DeletePhotoInput | null> {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body) || typeof body.reason !== 'string' || body.reason.trim() === '') {
      return null;
    }

    return {
      reason: body.reason.trim(),
    };
  } catch {
    return null;
  }
}

export async function parseCreatePhotoFormData(request: Request): Promise<
  | {
      input: CreatePhotoInput;
      file: File;
    }
  | { error: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE' }
> {
  const formData = await request.formData();
  const file = formData.get('file');
  const siteId = sanitizeString(formData.get('siteId'));
  const freeMissionId = sanitizeString(formData.get('freeMissionId'));
  const planningAssignmentId = sanitizeString(formData.get('planningAssignmentId'));
  const category = parsePhotoCategory(formData.get('category'));
  const tags = parsePhotoTags(formData.get('tags'));
  const descriptionValue = formData.get('description');
  const description =
    descriptionValue === null || descriptionValue === undefined
      ? ''
      : typeof descriptionValue === 'string'
        ? descriptionValue
        : null;
  const timestampLocal = sanitizeDateTimeString(formData.get('timestampLocal'));
  const latitude = sanitizeOptionalNumber(formData.get('lat'));
  const longitude = sanitizeOptionalNumber(formData.get('lng'));

  if (
    !(file instanceof File) ||
    (!siteId && !freeMissionId) ||
    (siteId && freeMissionId) ||
    !category ||
    !tags ||
    description === null ||
    !timestampLocal ||
    latitude === undefined ||
    longitude === undefined
  ) {
    return { error: 'BAD_REQUEST' };
  }

  if (file.size <= 0 || file.size > MAX_PHOTO_FILE_SIZE_BYTES) {
    return { error: 'PAYLOAD_TOO_LARGE' };
  }

  if (!file.type.startsWith('image/')) {
    return { error: 'BAD_REQUEST' };
  }

  return {
    file,
    input: {
      siteId,
      freeMissionId,
      planningAssignmentId,
      category,
      tags,
      description,
      latitude,
      longitude,
      timestampLocal,
    },
  };
}

export function parsePhotoListQuery(searchParams: URLSearchParams) {
  return {
    page: parsePage(searchParams.get('page')),
    uploadedByIds: parseIdList(searchParams.get('uploadedBy')),
    category: parsePhotoCategory(searchParams.get('category')),
    tag: parsePhotoTag(searchParams.get('tag')),
    from: parseDate(searchParams.get('from')),
    to: parseDate(searchParams.get('to')),
    sort: parseSort(searchParams.get('sort')),
  };
}

export function parseLogsQuery(searchParams: URLSearchParams) {
  return {
    page: parsePage(searchParams.get('page')),
  };
}

export function jsonAdminLogsError(
  code: AdminLogsApiErrorCode,
  status: number,
  message: string,
) {
  return Response.json(
    {
      code,
      message,
    },
    { status },
  );
}

export function parseAdminLogsQuery(searchParams: URLSearchParams) {
  return {
    page: parsePage(searchParams.get('page')),
    deletedBy: sanitizeString(searchParams.get('deletedBy')),
    from: parseDate(searchParams.get('from')),
    to: parseDate(searchParams.get('to')),
  };
}

export async function parseAdminLogsExportInput(request: Request): Promise<AdminLogsExportInput | null> {
  try {
    const body = (await request.json()) as unknown;

    if (!isRecord(body)) {
      return null;
    }

    const from =
      body.from === undefined || body.from === null ? null : sanitizeDateTimeString(body.from);
    const to = body.to === undefined || body.to === null ? null : sanitizeDateTimeString(body.to);
    const deletedBy =
      body.deletedBy === undefined || body.deletedBy === null ? null : sanitizeString(body.deletedBy);

    if (
      (body.from !== undefined && body.from !== null && !from) ||
      (body.to !== undefined && body.to !== null && !to) ||
      (body.deletedBy !== undefined && body.deletedBy !== null && !deletedBy)
    ) {
      return null;
    }

    if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
      return null;
    }

    return {
      from,
      to,
      deletedBy,
    };
  } catch {
    return null;
  }
}

export async function getAccessibleSiteForPhoto(
  prisma: PrismaClient,
  siteId: string,
  user: AuthLikeUser,
  options: { date?: Date } = {},
) {
  if (user.role === Role.DIRECTION || user.role === Role.ADMIN) {
    return prisma.site.findUnique({
      where: { id: siteId },
      select: {
        id: true,
        name: true,
        status: true,
        project: {
          select: {
            projectManagerId: true,
          },
        },
      },
    });
  }

  if (user.role === Role.PROJECT_MANAGER) {
    return prisma.site.findFirst({
      where: {
        id: siteId,
        project: {
          projectManagerId: user.id,
        },
      },
      select: {
        id: true,
        name: true,
        status: true,
        project: {
          select: {
            projectManagerId: true,
          },
        },
      },
    });
  }

  if (isBusinessManagerRole(user.role)) {
    return prisma.site.findFirst({
      where: {
        id: siteId,
        planningAssignments: {
          some: {
            deletedAt: null,
            supervisor: {
              role: { in: [...getBusinessManagedResourceRoles(user.role)] },
              isActive: true,
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        status: true,
        project: {
          select: {
            projectManagerId: true,
          },
        },
      },
    });
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    return prisma.site.findFirst({
      where: {
        id: siteId,
        ...generalSupervisorPlanningSiteWhere(user, options.date ?? new Date()),
      },
      select: {
        id: true,
        name: true,
        status: true,
        project: {
          select: {
            projectManagerId: true,
          },
        },
      },
    });
  }

  const assignmentDate = options.date ? formatDateKey(options.date) : null;

  return prisma.site.findFirst({
    where: {
      id: siteId,
      OR: [
        {
          planningAssignments: {
            some: {
              supervisorId: user.id,
              deletedAt: null,
              ...(assignmentDate ? { date: new Date(`${assignmentDate}T00:00:00.000Z`) } : {}),
            },
          },
        },
        {
          clockInRecords: {
            some: {
              userId: user.id,
            },
          },
        },
        {
          photos: {
            some: {
              uploadedById: user.id,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      project: {
        select: {
          projectManagerId: true,
        },
      },
    },
  });
}

export async function preparePhotoUpload(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const sourceBuffer = Buffer.from(arrayBuffer);
  const originalExtension = extname(file.name).toLowerCase();

  if (file.size <= COMPRESS_PHOTO_FILE_SIZE_BYTES) {
    return {
      buffer: sourceBuffer,
      contentType: file.type || 'application/octet-stream',
      fileSize: sourceBuffer.byteLength,
      format: normalizeFormat(file.type, originalExtension),
      filename: file.name,
    };
  }

  const compressedBuffer = await sharp(sourceBuffer).rotate().jpeg({ quality: 80 }).toBuffer();
  const compressedFilename = replaceExtension(file.name, '.jpg');

  return {
    buffer: compressedBuffer,
    contentType: 'image/jpeg',
    fileSize: compressedBuffer.byteLength,
    format: 'jpg',
    filename: compressedFilename,
  };
}

export async function createPhoto(
  prisma: PrismaClient,
  payload: {
    user: AuthLikeUser;
    input: CreatePhotoInput;
    file: File;
  },
) {
  const timestampLocal = new Date(payload.input.timestampLocal);
  if (payload.input.freeMissionId) {
    if (!FIELD_USER_ROLES.includes(payload.user.role)) {
      return { code: 'FORBIDDEN' as const, photo: null };
    }

    const freeMission = await prisma.freeMission.findFirst({
      where: {
        id: payload.input.freeMissionId,
        assigneeId: payload.user.id,
        deletedAt: null,
      },
      select: {
        id: true,
        date: true,
      },
    });

    if (!freeMission || formatDateKey(freeMission.date) !== formatDateKey(timestampLocal)) {
      return { code: 'FORBIDDEN' as const, photo: null };
    }

    const prepared = await preparePhotoUpload(payload.file);
    const storageKey = generatePhotoStorageKey({
      siteId: `free-mission-${freeMission.id}`,
      userId: payload.user.id,
      filename: prepared.filename,
      timestamp: timestampLocal,
    });

    let stored: Awaited<ReturnType<typeof uploadPrivatePhotoObject>>;
    try {
      stored = await uploadPrivatePhotoObject({
        storageKey,
        body: prepared.buffer,
        contentType: prepared.contentType,
      });
    } catch (error) {
      console.error('Private free mission photo upload failed:', {
        providerError: error instanceof Error ? error.message : String(error),
        storageKeyPrefix: storageKey.split('/').slice(0, 2).join('/'),
      });
      return { code: 'UPLOAD_FAILED' as const, photo: null };
    }

    const created = await prisma.photo.create({
      data: {
        siteId: null,
        freeMissionId: freeMission.id,
        uploadedById: payload.user.id,
        planningAssignmentId: null,
        category: payload.input.category,
        tags: payload.input.tags,
        description: payload.input.description,
        filename: prepared.filename,
        storageKey,
        url: stored.url,
        fileSize: prepared.fileSize,
        format: prepared.format,
        latitude: payload.input.latitude === null ? null : new Prisma.Decimal(payload.input.latitude),
        longitude: payload.input.longitude === null ? null : new Prisma.Decimal(payload.input.longitude),
        timestampLocal,
        takenAt: timestampLocal,
      },
      select: photoSelect,
    });

    return {
      code: null,
      photo: serializePhoto(created),
    };
  }

  if (!payload.input.siteId) {
    return { code: 'FORBIDDEN' as const, photo: null };
  }

  const site = await getAccessibleSiteForPhoto(prisma, payload.input.siteId, payload.user, {
    date: timestampLocal,
  });

  if (!site) {
    return { code: 'FORBIDDEN' as const, photo: null };
  }

  if (site.status !== SiteStatus.ACTIVE) {
    return { code: 'SITE_INACTIVE' as const, photo: null };
  }

  if (payload.input.planningAssignmentId) {
    if (!FIELD_USER_ROLES.includes(payload.user.role)) {
      return { code: 'ASSIGNMENT_NOT_FOUND' as const, photo: null };
    }

    const assignment = await prisma.planningAssignment.findFirst({
      where: {
        id: payload.input.planningAssignmentId,
        supervisorId: payload.user.id,
        deletedAt: null,
      },
      select: {
        id: true,
        siteId: true,
        date: true,
      },
    });

    if (!assignment) {
      return { code: 'ASSIGNMENT_NOT_FOUND' as const, photo: null };
    }

    if (assignment.siteId !== site.id) {
      return { code: 'ASSIGNMENT_SITE_MISMATCH' as const, photo: null };
    }

    if (formatDateKey(assignment.date) !== formatDateKey(timestampLocal)) {
      return { code: 'ASSIGNMENT_DATE_MISMATCH' as const, photo: null };
    }
  }

  const prepared = await preparePhotoUpload(payload.file);
  const storageKey = generatePhotoStorageKey({
    siteId: site.id,
    userId: payload.user.id,
    filename: prepared.filename,
    timestamp: new Date(payload.input.timestampLocal),
  });
  let stored: Awaited<ReturnType<typeof uploadPrivatePhotoObject>>;
  try {
    stored = await uploadPrivatePhotoObject({
      storageKey,
      body: prepared.buffer,
      contentType: prepared.contentType,
    });
  } catch (error) {
    console.error('Private photo upload failed:', {
      providerError: error instanceof Error ? error.message : String(error),
      storageKeyPrefix: storageKey.split('/').slice(0, 2).join('/'),
      contentType: prepared.contentType,
      fileSize: prepared.fileSize,
    });
    return { code: 'UPLOAD_FAILED' as const, photo: null };
  }

  const created = await prisma.photo.create({
    data: {
      siteId: site.id,
      uploadedById: payload.user.id,
      planningAssignmentId: payload.input.planningAssignmentId,
      category: payload.input.category,
      tags: payload.input.tags,
      description: payload.input.description,
      filename: prepared.filename,
      storageKey,
      url: stored.url,
      fileSize: prepared.fileSize,
      format: prepared.format,
      latitude:
        payload.input.latitude === null ? null : new Prisma.Decimal(payload.input.latitude),
      longitude:
        payload.input.longitude === null ? null : new Prisma.Decimal(payload.input.longitude),
      timestampLocal,
      takenAt: timestampLocal,
    },
    select: photoSelect,
  });

  return {
    code: null,
    photo: serializePhoto(created),
  };
}

export async function getAccessiblePhotoById(
  prisma: PrismaClient,
  payload: {
    photoId: string;
    user: AuthLikeUser;
  },
) {
  const photo = await prisma.photo.findUnique({
    where: {
      id: payload.photoId,
    },
    select: {
      ...photoSelect,
      site: {
        select: {
          project: {
            select: {
              projectManagerId: true,
            },
          },
        },
      },
      freeMissionId: true,
      freeMission: {
        select: {
          action: true,
          project: {
            select: {
              id: true,
              name: true,
              projectManagerId: true,
            },
          },
        },
      },
    },
  });

  if (!photo || photo.isDeleted) {
    return null;
  }

  if (isOwnPhotoOnlyRole(payload.user.role)) {
    return photo.uploadedById === payload.user.id ? serializePhoto(photo) : null;
  }

  if (payload.user.role === Role.PROJECT_MANAGER) {
    const projectManagerId = photo.site?.project.projectManagerId ?? photo.freeMission?.project.projectManagerId;
    return projectManagerId === payload.user.id ? serializePhoto(photo) : null;
  }

  if (canReadAllSitePhotos(payload.user.role)) {
    if (
      payload.user.role === Role.COORDINATOR ||
      payload.user.role === Role.GENERAL_SUPERVISOR ||
      isBusinessManagerRole(payload.user.role)
    ) {
      if (!photo.siteId) {
        return photo.uploadedById === payload.user.id || photo.freeMissionId ? serializePhoto(photo) : null;
      }
      const site = await getAccessibleSiteForPhoto(prisma, photo.siteId, payload.user);
      return site ? serializePhoto(photo) : null;
    }

    return serializePhoto(photo);
  }

  return null;
}

export async function listSitePhotos(
  prisma: PrismaClient,
  payload: {
    siteId: string;
    user: AuthLikeUser;
    page: number;
    uploadedByIds: string[];
    category: PhotoCategory | null;
    tag: PhotoTag | null;
    from: Date | null;
    to: Date | null;
    sort: 'asc' | 'desc';
  },
): Promise<PaginatedPhotosResponse | null> {
  const site = await getAccessibleSiteForPhoto(prisma, payload.siteId, payload.user);

  if (!site) {
    return null;
  }

  const where: Prisma.PhotoWhereInput = {
    siteId: payload.siteId,
    isDeleted: false,
  };

  if (isOwnPhotoOnlyRole(payload.user.role)) {
    where.uploadedById = payload.user.id;
  } else if (payload.uploadedByIds.length > 0) {
    where.uploadedById = {
      in: payload.uploadedByIds,
    };
  }

  if (payload.category) {
    where.category = payload.category;
  }

  if (payload.tag) {
    where.tags = {
      has: payload.tag,
    };
  }

  if (payload.from || payload.to) {
    where.timestampLocal = {};
    if (payload.from) {
      where.timestampLocal.gte = payload.from;
    }
    if (payload.to) {
      where.timestampLocal.lte = payload.to;
    }
  }

  const authorWhere: Prisma.PhotoWhereInput = {
    siteId: payload.siteId,
    isDeleted: false,
    ...(isOwnPhotoOnlyRole(payload.user.role) ? { uploadedById: payload.user.id } : {}),
  };

  const [photos, totalItems, authorRows] = await Promise.all([
    prisma.photo.findMany({
      where,
      orderBy: [{ timestampLocal: payload.sort }, { id: payload.sort }],
      skip: (payload.page - 1) * PHOTO_PAGE_SIZE,
      take: PHOTO_PAGE_SIZE,
      select: photoSelect,
    }),
    prisma.photo.count({ where }),
    prisma.photo.findMany({
      where: authorWhere,
      distinct: ['uploadedById'],
      orderBy: [{ uploadedBy: { firstName: 'asc' } }, { uploadedBy: { lastName: 'asc' } }],
      select: {
        uploadedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    }),
  ]);

  return {
    items: photos.map((photo) => serializePhoto(photo, { includeUrl: false })),
    page: payload.page,
    pageSize: PHOTO_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / PHOTO_PAGE_SIZE)),
    authors: authorRows.map((row) => ({
      id: row.uploadedBy.id,
      firstName: row.uploadedBy.firstName,
      lastName: row.uploadedBy.lastName,
      role: row.uploadedBy.role,
    })),
    sites: [{ id: site.id, name: site.name }],
  };
}

export async function listProjectPhotos(
  prisma: PrismaClient,
  payload: {
    projectId: string;
    user: AuthLikeUser;
    page: number;
    uploadedByIds: string[];
    category: PhotoCategory | null;
    tag: PhotoTag | null;
    from: Date | null;
    to: Date | null;
    sort: 'asc' | 'desc';
  },
): Promise<PaginatedPhotosResponse | null> {
  const project = await getAccessibleProjectForPhotos(prisma, payload.projectId, payload.user);

  if (!project) {
    return null;
  }

  const where: Prisma.PhotoWhereInput = {
    isDeleted: false,
    site: {
      projectId: payload.projectId,
    },
  };

  if (isOwnPhotoOnlyRole(payload.user.role)) {
    where.uploadedById = payload.user.id;
  } else if (payload.uploadedByIds.length > 0) {
    where.uploadedById = {
      in: payload.uploadedByIds,
    };
  }

  if (payload.category) {
    where.category = payload.category;
  }

  if (payload.tag) {
    where.tags = {
      has: payload.tag,
    };
  }

  if (payload.from || payload.to) {
    where.timestampLocal = {};
    if (payload.from) {
      where.timestampLocal.gte = payload.from;
    }
    if (payload.to) {
      where.timestampLocal.lte = payload.to;
    }
  }

  const authorWhere: Prisma.PhotoWhereInput = {
    isDeleted: false,
    site: {
      projectId: payload.projectId,
    },
    ...(isOwnPhotoOnlyRole(payload.user.role) ? { uploadedById: payload.user.id } : {}),
  };

  const [photos, totalItems, authorRows] = await Promise.all([
    prisma.photo.findMany({
      where,
      orderBy: [{ timestampLocal: payload.sort }, { id: payload.sort }],
      skip: (payload.page - 1) * PHOTO_PAGE_SIZE,
      take: PHOTO_PAGE_SIZE,
      select: {
        ...photoSelect,
        site: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.photo.count({ where }),
    prisma.photo.findMany({
      where: authorWhere,
      distinct: ['uploadedById'],
      orderBy: [{ uploadedBy: { firstName: 'asc' } }, { uploadedBy: { lastName: 'asc' } }],
      select: {
        uploadedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    }),
  ]);

  return {
    items: photos.map((photo) => serializePhotoWithSiteName(photo, photo.site?.name ?? 'Mission libre', { includeUrl: false })),
    page: payload.page,
    pageSize: PHOTO_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / PHOTO_PAGE_SIZE)),
    authors: authorRows.map((row) => ({
      id: row.uploadedBy.id,
      firstName: row.uploadedBy.firstName,
      lastName: row.uploadedBy.lastName,
      role: row.uploadedBy.role,
    })),
    sites: project.sites.map((site) => ({ id: site.id, name: site.name })),
  };
}

export async function softDeletePhoto(
  prisma: PrismaClient,
  payload: {
    photoId: string;
    user: AuthLikeUser;
    reason: string;
  },
) {
  const photo = await prisma.photo.findUnique({
    where: {
      id: payload.photoId,
    },
    select: {
      id: true,
      siteId: true,
      freeMissionId: true,
      uploadedById: true,
      isDeleted: true,
      site: {
        select: {
          project: {
            select: {
              projectManagerId: true,
            },
          },
        },
      },
      freeMission: {
        select: {
          project: {
            select: {
              projectManagerId: true,
            },
          },
        },
      },
    },
  });

  if (!photo || photo.isDeleted) {
    return { code: 'NOT_FOUND' as const, photo: null };
  }

  if (payload.user.role === Role.PROJECT_MANAGER && photo.site?.project.projectManagerId !== payload.user.id) {
    return { code: 'FORBIDDEN' as const, photo: null };
  }

  try {
    const storageRecord = await prisma.photo.findUnique({
      where: {
        id: payload.photoId,
      },
      select: {
        storageKey: true,
      },
    });

    if (!storageRecord) {
      return { code: 'NOT_FOUND' as const, photo: null };
    }

    await removePrivatePhotoObject(storageRecord.storageKey);
  } catch {
    return { code: 'DELETE_FAILED' as const, photo: null };
  }

  const deleted = await prisma.$transaction(async (tx) => {
    await tx.photo.update({
      where: {
        id: payload.photoId,
      },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedById: payload.user.id,
      },
    });

    await tx.photoDeletionLog.create({
      data: {
        photoId: payload.photoId,
        deletedById: payload.user.id,
        originalAuthorId: photo.uploadedById,
        reason: payload.reason,
      },
    });

    return tx.photo.findUniqueOrThrow({
      where: {
        id: payload.photoId,
      },
      select: photoSelect,
    });
  });

  return {
    code: null,
    photo: serializePhoto(deleted, { includeUrl: false }),
  };
}

export async function listPhotoDeletionLogs(
  prisma: PrismaClient,
  page: number,
): Promise<PaginatedPhotoDeletionLogsResponse> {
  const [logs, totalItems] = await Promise.all([
    prisma.photoDeletionLog.findMany({
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PHOTO_PAGE_SIZE,
      take: PHOTO_PAGE_SIZE,
      select: photoDeletionLogSelect,
    }),
    prisma.photoDeletionLog.count(),
  ]);

  return {
    items: logs.map(serializePhotoDeletionLog),
    page,
    pageSize: PHOTO_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / PHOTO_PAGE_SIZE)),
  };
}

export async function listAdminDeletionLogs(
  prisma: PrismaClient,
  query: {
    page: number;
    deletedBy: string | null;
    from: Date | null;
    to: Date | null;
  },
): Promise<PaginatedAdminDeletionLogsResponse> {
  const where: Prisma.PhotoDeletionLogWhereInput = {};

  if (query.deletedBy) {
    where.deletedById = query.deletedBy;
  }

  if (query.from || query.to) {
    where.deletedAt = {};
    if (query.from) {
      where.deletedAt.gte = query.from;
    }
    if (query.to) {
      where.deletedAt.lte = query.to;
    }
  }

  const [logs, totalItems] = await Promise.all([
    prisma.photoDeletionLog.findMany({
      where,
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * PHOTO_PAGE_SIZE,
      take: PHOTO_PAGE_SIZE,
      select: adminPhotoDeletionLogSelect,
    }),
    prisma.photoDeletionLog.count({ where }),
  ]);

  return {
    items: logs.map(serializeAdminDeletionLog),
    page: query.page,
    pageSize: PHOTO_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / PHOTO_PAGE_SIZE)),
  };
}

export async function buildAdminDeletionLogsCsv(
  prisma: PrismaClient,
  input: AdminLogsExportInput,
) {
  const where: Prisma.PhotoDeletionLogWhereInput = {};

  if (input.deletedBy) {
    where.deletedById = input.deletedBy;
  }

  if (input.from || input.to) {
    where.deletedAt = {};
    if (input.from) {
      where.deletedAt.gte = new Date(input.from);
    }
    if (input.to) {
      where.deletedAt.lte = new Date(input.to);
    }
  }

  const logs = await prisma.photoDeletionLog.findMany({
    where,
    orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
    select: adminPhotoDeletionLogSelect,
  });

  const lines = [
    [
      'Photo',
      'Chantier',
      'Supprime par',
      'Role suppresseur',
      'Date suppression',
      'Motif',
      'Auteur original',
    ].join(','),
    ...logs.map((log) =>
      [
        buildAdminPhotoLabel(log),
        log.photo.site?.name ?? 'Mission libre',
        `${log.deletedBy.firstName} ${log.deletedBy.lastName}`,
        log.deletedBy.role,
        log.deletedAt.toISOString(),
        log.reason,
        `${log.originalAuthor.firstName} ${log.originalAuthor.lastName}`,
      ]
        .map(escapeCsvValue)
        .join(','),
    ),
  ];

  return {
    fileName: `admin-photo-logs-${new Date().toISOString().slice(0, 10)}.csv`,
    contentType: 'text/csv; charset=utf-8',
    buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'),
  };
}

export function serializePhoto(
  photo: SerializablePhoto,
  options: { includeUrl?: boolean } = {},
): PhotoDetail {
  const includeUrl = options.includeUrl ?? true;

  return {
    id: photo.id,
    siteId: photo.siteId,
    freeMissionId: photo.freeMissionId,
    siteName: null,
    uploadedById: photo.uploadedById,
    planningAssignmentId: photo.planningAssignmentId,
    assignmentAction: photo.planningAssignment?.action ?? null,
    assignmentStatus: photo.planningAssignment?.status ?? null,
    category: photo.category,
    tags: photo.tags,
    description: photo.description,
    filename: photo.filename,
    fileSize: photo.fileSize,
    format: photo.format,
    latitude: photo.latitude?.toNumber() ?? null,
    longitude: photo.longitude?.toNumber() ?? null,
    timestampLocal: photo.timestampLocal.toISOString(),
    takenAt: photo.takenAt.toISOString(),
    isDeleted: photo.isDeleted,
    deletedAt: photo.deletedAt?.toISOString() ?? null,
    createdAt: photo.createdAt.toISOString(),
    author: {
      id: photo.uploadedBy.id,
      firstName: photo.uploadedBy.firstName,
      lastName: photo.uploadedBy.lastName,
      role: photo.uploadedBy.role,
    },
    url: includeUrl && !photo.isDeleted ? createInternalPhotoUrl(photo.id) : null,
  };
}

function serializePhotoWithSiteName(
  photo: SerializablePhoto & { site?: { name: string } | null },
  siteName: string,
  options: { includeUrl?: boolean } = {},
) {
  const serialized = serializePhoto(photo, options);
  return {
    ...serialized,
    siteName,
  };
}

export function serializePhotoDeletionLog(log: SerializablePhotoDeletionLog): PhotoDeletionLogItem {
  return {
    id: log.id,
    photoId: log.photoId,
    deletedById: log.deletedById,
    originalAuthorId: log.originalAuthorId,
    reason: log.reason,
    deletedAt: log.deletedAt.toISOString(),
    photo: {
      id: log.photo.id,
      siteId: log.photo.siteId,
      filename: log.photo.filename,
      category: log.photo.category,
    },
    deletedBy: {
      id: log.deletedBy.id,
      firstName: log.deletedBy.firstName,
      lastName: log.deletedBy.lastName,
      role: log.deletedBy.role,
    },
    originalAuthor: {
      id: log.originalAuthor.id,
      firstName: log.originalAuthor.firstName,
      lastName: log.originalAuthor.lastName,
      role: log.originalAuthor.role,
    },
  };
}

export function serializeAdminDeletionLog(log: SerializableAdminPhotoDeletionLog): AdminDeletionLogItem {
  return {
    id: log.id,
    photoId: log.photoId,
    photoLabel: buildAdminPhotoLabel(log),
    photoFilename: log.photo.filename,
    photoTakenAt: log.photo.takenAt.toISOString(),
    site: {
      id: log.photo.site?.id ?? '',
      name: log.photo.site?.name ?? 'Mission libre',
    },
    deletedBy: {
      id: log.deletedBy.id,
      firstName: log.deletedBy.firstName,
      lastName: log.deletedBy.lastName,
      role: log.deletedBy.role,
    },
    deletedAt: log.deletedAt.toISOString(),
    reason: log.reason,
    originalAuthor: {
      id: log.originalAuthor.id,
      firstName: log.originalAuthor.firstName,
      lastName: log.originalAuthor.lastName,
      role: log.originalAuthor.role,
    },
  };
}

function buildAdminPhotoLabel(log: SerializableAdminPhotoDeletionLog) {
  const takenAt = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(log.photo.takenAt);
  return `${log.photo.filename} - ${takenAt}`;
}

export function getPhotoSignedUrlTtlSeconds() {
  return getSignedPhotoUrlTtlSeconds();
}

export function createInternalPhotoUrl(photoId: string) {
  return `/api/photos/${encodeURIComponent(photoId)}/content`;
}

export async function getAccessiblePhotoStorageById(
  prisma: PrismaClient,
  payload: {
    photoId: string;
    user: AuthLikeUser;
  },
) {
  const photo = await prisma.photo.findUnique({
    where: {
      id: payload.photoId,
    },
    select: {
      id: true,
      siteId: true,
      freeMissionId: true,
      uploadedById: true,
      storageKey: true,
      url: true,
      isDeleted: true,
      site: {
        select: {
          project: {
            select: {
              projectManagerId: true,
            },
          },
        },
      },
      freeMission: {
        select: {
          project: {
            select: {
              projectManagerId: true,
            },
          },
        },
      },
    },
  });

  if (!photo || photo.isDeleted) {
    return null;
  }

  if (isOwnPhotoOnlyRole(payload.user.role)) {
    return photo.uploadedById === payload.user.id ? photo : null;
  }

  if (payload.user.role === Role.PROJECT_MANAGER) {
    const projectManagerId = photo.site?.project.projectManagerId ?? photo.freeMission?.project.projectManagerId;
    return projectManagerId === payload.user.id ? photo : null;
  }

  if (canReadAllSitePhotos(payload.user.role)) {
    if (
      payload.user.role === Role.COORDINATOR ||
      payload.user.role === Role.GENERAL_SUPERVISOR ||
      isBusinessManagerRole(payload.user.role)
    ) {
      if (!photo.siteId) {
        return photo.freeMissionId || photo.uploadedById === payload.user.id ? photo : null;
      }
      const site = await getAccessibleSiteForPhoto(prisma, photo.siteId, payload.user);
      return site ? photo : null;
    }

    return photo;
  }

  return null;
}

function parsePhotoCategory(value: FormDataEntryValue | string | null) {
  if (typeof value !== 'string') {
    return null;
  }

  return Object.values(PhotoCategory).includes(value as PhotoCategory)
    ? (value as PhotoCategory)
    : null;
}

function parsePhotoTag(value: FormDataEntryValue | string | null) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  return Object.values(PhotoTag).includes(value as PhotoTag) ? (value as PhotoTag) : null;
}

function parsePhotoTags(value: FormDataEntryValue | null): PhotoTag[] | null {
  if (value === null || value === '') {
    return [];
  }

  if (typeof value !== 'string') {
    return null;
  }

  const rawTags = value.trim().startsWith('[')
    ? parseJsonStringArray(value)
    : value.split(',').map((item) => item.trim()).filter(Boolean);

  if (!rawTags) {
    return null;
  }

  const tags = new Set<PhotoTag>();
  for (const rawTag of rawTags) {
    const tag = parsePhotoTag(rawTag);
    if (!tag) {
      return null;
    }

    tags.add(tag);
  }

  return [...tags];
}

function parseJsonStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function sanitizeOptionalNumber(value: FormDataEntryValue | null) {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeDateTimeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parsePage(value: string | null) {
  if (!value) {
    return 1;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseIdList(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseSort(value: string | null): 'asc' | 'desc' {
  return value === 'asc' ? 'asc' : 'desc';
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeFormat(contentType: string, extension: string) {
  if (contentType === 'image/jpeg') {
    return 'jpg';
  }

  if (contentType === 'image/png') {
    return 'png';
  }

  if (contentType === 'image/webp') {
    return 'webp';
  }

  return extension.replace('.', '') || 'bin';
}

function replaceExtension(filename: string, nextExtension: string) {
  const currentExtension = extname(filename);
  if (!currentExtension) {
    return `${filename}${nextExtension}`;
  }

  return `${filename.slice(0, -currentExtension.length)}${nextExtension}`;
}

function escapeCsvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function getAccessibleProjectForPhotos(
  prisma: PrismaClient,
  projectId: string,
  user: AuthLikeUser,
): Promise<{ id: string; sites: PhotoSiteOption[] } | null> {
  if (user.role === Role.DIRECTION || user.role === Role.ADMIN) {
    return prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        sites: {
          select: {
            id: true,
            name: true,
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        },
      },
    });
  }

  if (user.role === Role.PROJECT_MANAGER) {
    return prisma.project.findFirst({
      where: {
        id: projectId,
        projectManagerId: user.id,
      },
      select: {
        id: true,
        sites: {
          select: {
            id: true,
            name: true,
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        },
      },
    });
  }

  const sites = await prisma.site.findMany({
    where: {
      projectId,
      OR: [
        {
          teams: {
            some: {
              status: TeamStatus.ACTIVE,
              members: {
                some: {
                  userId: user.id,
                  status: TeamMemberStatus.ACTIVE,
                },
              },
            },
          },
        },
        {
          clockInRecords: {
            some: {
              userId: user.id,
            },
          },
        },
        {
          photos: {
            some: {
              uploadedById: user.id,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  return sites.length > 0 ? { id: projectId, sites } : null;
}
