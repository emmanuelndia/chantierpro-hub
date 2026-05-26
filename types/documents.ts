import type { Role } from '@prisma/client';

export type DocumentAttachmentContext = {
  projectId: string | null;
  siteId: string | null;
  reportId: string | null;
};

export type DocumentAttachmentItem = DocumentAttachmentContext & {
  id: string;
  filename: string;
  fileSize: number;
  contentType: string;
  extension: string;
  createdAt: string;
  uploadedBy: {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
  };
  downloadUrl: string;
};

export type DocumentAttachmentListResponse = {
  items: DocumentAttachmentItem[];
};

export type DocumentApiErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'UPLOAD_FAILED'
  | 'DELETE_FAILED'
  | 'STORAGE_FAILED';
