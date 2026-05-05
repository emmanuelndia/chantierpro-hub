import type { Role } from '@prisma/client';

export type AdminLogActor = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export type AdminDeletionLogItem = {
  id: string;
  photoId: string;
  site: {
    id: string;
    name: string;
  };
  deletedBy: AdminLogActor;
  deletedAt: string;
  reason: string;
  originalAuthor: AdminLogActor;
};

export type PaginatedAdminDeletionLogsResponse = {
  items: AdminDeletionLogItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type AdminLogsExportInput = {
  from: string | null;
  to: string | null;
  deletedBy: string | null;
};

export type AdminLogsApiErrorCode = 'BAD_REQUEST' | 'FORBIDDEN' | 'EXPORT_FAILED';
