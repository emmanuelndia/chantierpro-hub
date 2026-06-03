import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Prisma, Role, type PrismaClient } from '@prisma/client';
import { getOperationalSiteIds } from '@/lib/dashboard';
import { getBusinessManagedResourceRoles, isBusinessManagerRole } from '@/lib/field-roles';
import { fetchPrivateStorageObject, removePrivateStorageObject, uploadPrivateStorageObject } from '@/lib/storage';
import type { DocumentApiErrorCode, DocumentAttachmentItem } from '@/types/documents';

const MAX_DOCUMENT_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls', '.docx', '.png', '.jpg', '.jpeg']);
const ALLOWED_DOCUMENT_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]);
const PROJECT_SITE_UPLOAD_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
const DOCUMENT_DELETE_ADMIN_ROLES: readonly Role[] = [Role.DIRECTION, Role.ADMIN];

type AuthLikeUser = {
  id: string;
  role: Role;
};

type DocumentContextInput = {
  projectId: string | null;
  siteId: string | null;
  reportId: string | null;
};

export const documentAttachmentSelect = {
  id: true,
  projectId: true,
  siteId: true,
  reportId: true,
  uploadedById: true,
  filename: true,
  storageKey: true,
  url: true,
  fileSize: true,
  contentType: true,
  extension: true,
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
} satisfies Prisma.DocumentAttachmentSelect;

type SerializableDocumentAttachment = Prisma.DocumentAttachmentGetPayload<{
  select: typeof documentAttachmentSelect;
}>;

export function jsonDocumentError(code: DocumentApiErrorCode, status: number, message: string) {
  return Response.json({ code, message }, { status });
}

export function createInternalDocumentUrl(documentId: string) {
  return `/api/documents/${encodeURIComponent(documentId)}/content`;
}

export async function parseCreateDocumentFormData(request: Request): Promise<
  | {
      file: File;
      context: DocumentContextInput;
    }
  | { error: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_FORMAT' }
> {
  const formData = await request.formData();
  const file = formData.get('file');
  const context = parseDocumentContext({
    projectId: formData.get('projectId'),
    siteId: formData.get('siteId'),
    reportId: formData.get('reportId'),
  });

  if (!(file instanceof File) || !context) {
    return { error: 'BAD_REQUEST' };
  }

  const validationError = validateDocumentFile(file);
  if (validationError) {
    return { error: validationError };
  }

  return { file, context };
}

export function parseDocumentListQuery(searchParams: URLSearchParams) {
  return parseDocumentContext({
    projectId: searchParams.get('projectId'),
    siteId: searchParams.get('siteId'),
    reportId: searchParams.get('reportId'),
  });
}

export async function createDocumentAttachment(
  prisma: PrismaClient,
  payload: {
    user: AuthLikeUser;
    file: File;
    context: DocumentContextInput;
  },
) {
  const fileValidationError = validateDocumentFile(payload.file);
  if (fileValidationError) {
    return { code: fileValidationError, document: null };
  }

  const access = await canUploadDocumentForContext(prisma, payload.user, payload.context);
  if (!access) {
    return { code: 'FORBIDDEN' as const, document: null };
  }

  const body = Buffer.from(await payload.file.arrayBuffer());
  const extension = getSafeExtension(payload.file.name);
  const storageKey = generateDocumentStorageKey({
    userId: payload.user.id,
    filename: payload.file.name,
    context: payload.context,
  });

  let uploaded: { url: string };
  try {
    uploaded = await uploadPrivateStorageObject({
      storageKey,
      body,
      contentType: payload.file.type || inferContentType(extension),
    });
  } catch (error) {
    console.error('Document upload failed:', error);
    return { code: 'UPLOAD_FAILED' as const, document: null };
  }

  const document = await prisma.documentAttachment.create({
    data: {
      projectId: payload.context.projectId,
      siteId: payload.context.siteId,
      reportId: payload.context.reportId,
      uploadedById: payload.user.id,
      filename: sanitizeFilename(payload.file.name),
      storageKey,
      url: uploaded.url,
      fileSize: payload.file.size,
      contentType: payload.file.type || inferContentType(extension),
      extension: extension.slice(1),
    },
    select: documentAttachmentSelect,
  });

  return {
    code: null,
    document: serializeDocumentAttachment(document),
  };
}

export async function listDocumentAttachments(
  prisma: PrismaClient,
  payload: {
    user: AuthLikeUser;
    context: DocumentContextInput;
  },
) {
  const canRead = await canReadDocumentsForContext(prisma, payload.user, payload.context);
  if (!canRead) {
    return null;
  }

  const items = await prisma.documentAttachment.findMany({
    where: {
      ...documentContextWhere(payload.context),
      isDeleted: false,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: documentAttachmentSelect,
  });

  return {
    items: items.map(serializeDocumentAttachment),
  };
}

function documentContextWhere(context: DocumentContextInput): Prisma.DocumentAttachmentWhereInput {
  if (context.projectId) {
    return { projectId: context.projectId };
  }
  if (context.siteId) {
    return { siteId: context.siteId };
  }
  if (context.reportId) {
    return { reportId: context.reportId };
  }
  return {};
}

export async function getAccessibleDocumentStorageById(
  prisma: PrismaClient,
  payload: {
    documentId: string;
    user: AuthLikeUser;
  },
) {
  const document = await prisma.documentAttachment.findUnique({
    where: { id: payload.documentId },
    select: documentAttachmentSelect,
  });

  if (!document || document.isDeleted) {
    return null;
  }

  const canRead = await canReadDocumentsForContext(prisma, payload.user, {
    projectId: document.projectId,
    siteId: document.siteId,
    reportId: document.reportId,
  });

  return canRead ? document : null;
}

export async function streamDocumentContent(document: Pick<SerializableDocumentAttachment, 'storageKey' | 'contentType' | 'filename'>) {
  const response = await fetchPrivateStorageObject(document.storageKey);

  if (!response.ok || !response.body) {
    return null;
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      'Cache-Control': 'private, max-age=60',
      'Content-Type': response.headers.get('content-type') ?? document.contentType,
      'Content-Disposition': `attachment; filename="${encodeHeaderFilename(document.filename)}"`,
    },
  });
}

export async function softDeleteDocumentAttachment(
  prisma: PrismaClient,
  payload: {
    documentId: string;
    user: AuthLikeUser;
    reason: string;
  },
) {
  const document = await prisma.documentAttachment.findUnique({
    where: { id: payload.documentId },
    select: documentAttachmentSelect,
  });

  if (!document || document.isDeleted) {
    return { code: 'NOT_FOUND' as const, document: null };
  }

  const canDelete =
    DOCUMENT_DELETE_ADMIN_ROLES.includes(payload.user.role) ||
    document.uploadedById === payload.user.id ||
    (await canUploadDocumentForContext(prisma, payload.user, {
      projectId: document.projectId,
      siteId: document.siteId,
      reportId: document.reportId,
    }));

  if (!canDelete) {
    return { code: 'FORBIDDEN' as const, document: null };
  }

  try {
    await removePrivateStorageObject(document.storageKey);
  } catch (error) {
    console.error('Document storage delete failed:', error);
    return { code: 'DELETE_FAILED' as const, document: null };
  }

  const deleted = await prisma.$transaction(async (tx) => {
    await tx.documentAttachment.update({
      where: { id: payload.documentId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedById: payload.user.id,
      },
    });

    await tx.documentDeletionLog.create({
      data: {
        documentId: payload.documentId,
        deletedById: payload.user.id,
        originalAuthorId: document.uploadedById,
        reason: payload.reason,
      },
    });

    return tx.documentAttachment.findUniqueOrThrow({
      where: { id: payload.documentId },
      select: documentAttachmentSelect,
    });
  });

  return {
    code: null,
    document: serializeDocumentAttachment(deleted),
  };
}

export function serializeDocumentAttachment(document: SerializableDocumentAttachment): DocumentAttachmentItem {
  return {
    id: document.id,
    projectId: document.projectId,
    siteId: document.siteId,
    reportId: document.reportId,
    filename: document.filename,
    fileSize: document.fileSize,
    contentType: document.contentType,
    extension: document.extension,
    createdAt: document.createdAt.toISOString(),
    uploadedBy: {
      id: document.uploadedBy.id,
      firstName: document.uploadedBy.firstName,
      lastName: document.uploadedBy.lastName,
      role: document.uploadedBy.role,
    },
    downloadUrl: createInternalDocumentUrl(document.id),
  };
}

export async function canReadDocumentsForContext(prisma: PrismaClient, user: AuthLikeUser, context: DocumentContextInput) {
  if (context.reportId) {
    return canAccessReport(prisma, user, context.reportId);
  }

  if (context.siteId) {
    return canAccessSite(prisma, user, context.siteId);
  }

  if (context.projectId) {
    return canAccessProject(prisma, user, context.projectId);
  }

  return false;
}

async function canUploadDocumentForContext(prisma: PrismaClient, user: AuthLikeUser, context: DocumentContextInput) {
  if (context.reportId) {
    const report = await prisma.report.findUnique({
      where: { id: context.reportId },
      select: { userId: true },
    });
    return report?.userId === user.id;
  }

  if (!PROJECT_SITE_UPLOAD_ROLES.includes(user.role)) {
    return false;
  }

  if (context.siteId) {
    return canAccessSite(prisma, user, context.siteId);
  }

  if (context.projectId) {
    return canAccessProject(prisma, user, context.projectId);
  }

  return false;
}

async function canAccessProject(prisma: PrismaClient, user: AuthLikeUser, projectId: string) {
  if (user.role === Role.DIRECTION || user.role === Role.ADMIN) {
    return true;
  }

  if (user.role === Role.PROJECT_MANAGER) {
    return (await prisma.project.count({ where: { id: projectId, projectManagerId: user.id } })) > 0;
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    return (
      (await prisma.generalSupervisorSiteScope.count({
        where: {
          generalSupervisorId: user.id,
          site: { projectId },
          status: 'ACTIVE',
        },
      })) > 0
    );
  }

  if (isBusinessManagerRole(user.role)) {
    return (
      (await prisma.planningAssignment.count({
        where: {
          deletedAt: null,
          site: { projectId },
          supervisor: { role: { in: [...getBusinessManagedResourceRoles(user.role)] }, isActive: true },
        },
      })) > 0
    );
  }

  if (user.role === Role.COORDINATOR) {
    const siteIds = await getOperationalSiteIds(prisma, user.id);
    return (await prisma.site.count({ where: { id: { in: siteIds }, projectId } })) > 0;
  }

  return false;
}

async function canAccessSite(prisma: PrismaClient, user: AuthLikeUser, siteId: string) {
  if (user.role === Role.DIRECTION || user.role === Role.ADMIN) {
    return true;
  }

  if (user.role === Role.PROJECT_MANAGER) {
    return (await prisma.site.count({ where: { id: siteId, project: { projectManagerId: user.id } } })) > 0;
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    return (
      (await prisma.generalSupervisorSiteScope.count({
        where: { siteId, generalSupervisorId: user.id, status: 'ACTIVE' },
      })) > 0
    );
  }

  if (isBusinessManagerRole(user.role)) {
    return (
      (await prisma.planningAssignment.count({
        where: {
          siteId,
          deletedAt: null,
          supervisor: { role: { in: [...getBusinessManagedResourceRoles(user.role)] }, isActive: true },
        },
      })) > 0
    );
  }

  if (user.role === Role.COORDINATOR) {
    return (await getOperationalSiteIds(prisma, user.id)).includes(siteId);
  }

  return (
    (await prisma.report.count({
      where: { siteId, userId: user.id },
    })) > 0
  );
}

async function canAccessReport(prisma: PrismaClient, user: AuthLikeUser, reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { userId: true, siteId: true },
  });

  if (!report) {
    return false;
  }

  if (report.userId === user.id) {
    return true;
  }

  if (!report.siteId) {
    return false;
  }

  return canAccessSite(prisma, user, report.siteId);
}

function parseDocumentContext(input: {
  projectId: FormDataEntryValue | string | null;
  siteId: FormDataEntryValue | string | null;
  reportId: FormDataEntryValue | string | null;
}): DocumentContextInput | null {
  const context = {
    projectId: sanitizeString(input.projectId),
    siteId: sanitizeString(input.siteId),
    reportId: sanitizeString(input.reportId),
  };
  const count = [context.projectId, context.siteId, context.reportId].filter(Boolean).length;
  return count === 1 ? context : null;
}

function validateDocumentFile(file: File) {
  if (file.size <= 0 || file.size > MAX_DOCUMENT_FILE_SIZE_BYTES) {
    return 'PAYLOAD_TOO_LARGE' as const;
  }

  const extension = getSafeExtension(file.name);
  if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
    return 'UNSUPPORTED_FORMAT' as const;
  }

  if (file.type && !ALLOWED_DOCUMENT_CONTENT_TYPES.has(file.type)) {
    return 'UNSUPPORTED_FORMAT' as const;
  }

  return null;
}

function generateDocumentStorageKey(payload: {
  userId: string;
  filename: string;
  context: DocumentContextInput;
}) {
  const safeFileName = sanitizeFilename(payload.filename);
  const contextKey = payload.context.reportId
    ? `reports/${payload.context.reportId}`
    : payload.context.siteId
      ? `sites/${payload.context.siteId}`
      : `projects/${payload.context.projectId}`;
  const timestampLabel = new Date().toISOString().replace(/[:.]/g, '-');
  return `documents/${contextKey}/${payload.userId}/${timestampLabel}_${randomUUID()}_${safeFileName}`;
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeFilename(filename: string) {
  return filename.trim().replace(/[^\w.\- ()]+/g, '_').slice(0, 180) || 'document';
}

function getSafeExtension(filename: string) {
  return extname(filename).toLowerCase();
}

function inferContentType(extension: string) {
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (extension === '.xls') return 'application/vnd.ms-excel';
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function encodeHeaderFilename(filename: string) {
  return filename.replace(/["\\]/g, '_');
}
