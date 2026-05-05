import { Buffer } from 'node:buffer';
import { extname } from 'node:path';
import sharp from 'sharp';
import {
  PhotoCategory,
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
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];
const PHOTO_DELETE_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
const PHOTO_LOG_ROLES: readonly Role[] = [Role.DIRECTION, Role.ADMIN];
const ADMIN_LOG_ROLES: readonly Role[] = [Role.ADMIN];
const PHOTO_SITE_FULL_VIEW_ROLES: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];
const PHOTO_OWN_ONLY_ROLES: readonly Role[] = [Role.SUPERVISOR];
const MAX_PHOTO_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const COMPRESS_PHOTO_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const PHOTO_PAGE_SIZE = 20;

export const photoSelect = {
  id: true,
  siteId: true,
  uploadedById: true,
  category: true,
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
  const category = parsePhotoCategory(formData.get('category'));
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
    !siteId ||
    !category ||
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
      category,
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

  return prisma.site.findFirst({
    where: {
      id: siteId,
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
  const site = await getAccessibleSiteForPhoto(prisma, payload.input.siteId, payload.user);

  if (!site) {
    return { code: 'FORBIDDEN' as const, photo: null };
  }

  if (site.status !== SiteStatus.ACTIVE) {
    return { code: 'SITE_INACTIVE' as const, photo: null };
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
  } catch {
    return { code: 'UPLOAD_FAILED' as const, photo: null };
  }

  const timestampLocal = new Date(payload.input.timestampLocal);
  const created = await prisma.photo.create({
    data: {
      siteId: site.id,
      uploadedById: payload.user.id,
      category: payload.input.category,
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
    },
  });

  if (!photo || photo.isDeleted) {
    return null;
  }

  if (isOwnPhotoOnlyRole(payload.user.role)) {
    return photo.uploadedById === payload.user.id ? serializePhoto(photo) : null;
  }

  if (payload.user.role === Role.PROJECT_MANAGER) {
    return photo.site.project.projectManagerId === payload.user.id ? serializePhoto(photo) : null;
  }

  if (canReadAllSitePhotos(payload.user.role)) {
    if (payload.user.role === Role.COORDINATOR || payload.user.role === Role.GENERAL_SUPERVISOR) {
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
    items: photos.map((photo) => serializePhotoWithSiteName(photo, photo.site.name, { includeUrl: false })),
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
    },
  });

  if (!photo || photo.isDeleted) {
    return { code: 'NOT_FOUND' as const, photo: null };
  }

  if (payload.user.role === Role.PROJECT_MANAGER && photo.site.project.projectManagerId !== payload.user.id) {
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
      'Photo ID',
      'Chantier',
      'Supprime par',
      'Role suppresseur',
      'Date suppression',
      'Motif',
      'Auteur original',
    ].join(','),
    ...logs.map((log) =>
      [
        log.photoId,
        log.photo.site.name,
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
    siteName: null,
    uploadedById: photo.uploadedById,
    category: photo.category,
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
  photo: SerializablePhoto & { site: { name: string } },
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
    site: {
      id: log.photo.site.id,
      name: log.photo.site.name,
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
      uploadedById: true,
      storageKey: true,
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
    },
  });

  if (!photo || photo.isDeleted) {
    return null;
  }

  if (isOwnPhotoOnlyRole(payload.user.role)) {
    return photo.uploadedById === payload.user.id ? photo : null;
  }

  if (payload.user.role === Role.PROJECT_MANAGER) {
    return photo.site.project.projectManagerId === payload.user.id ? photo : null;
  }

  if (canReadAllSitePhotos(payload.user.role)) {
    if (payload.user.role === Role.COORDINATOR || payload.user.role === Role.GENERAL_SUPERVISOR) {
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

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
