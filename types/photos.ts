import type { PhotoCategory, Role } from '@prisma/client';

export type CreatePhotoInput = {
  siteId: string;
  category: PhotoCategory;
  description: string;
  latitude: number | null;
  longitude: number | null;
  timestampLocal: string;
};

export type PhotoAuthor = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export type PhotoItem = {
  id: string;
  siteId: string;
  siteName: string | null;
  uploadedById: string;
  category: PhotoCategory;
  description: string;
  filename: string;
  fileSize: number;
  format: string;
  latitude: number | null;
  longitude: number | null;
  timestampLocal: string;
  takenAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  author: PhotoAuthor;
  url: string | null;
};

export type PhotoDetail = PhotoItem;

export type PaginatedPhotosResponse = {
  items: PhotoItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  authors: PhotoAuthor[];
  sites: PhotoSiteOption[];
};

export type PhotoSiteOption = {
  id: string;
  name: string;
};

export type PhotoDeletionLogItem = {
  id: string;
  photoId: string;
  deletedById: string;
  originalAuthorId: string;
  reason: string;
  deletedAt: string;
  photo: {
    id: string;
    siteId: string;
    filename: string;
    category: PhotoCategory;
  };
  deletedBy: PhotoAuthor;
  originalAuthor: PhotoAuthor;
};

export type PaginatedPhotoDeletionLogsResponse = {
  items: PhotoDeletionLogItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type DeletePhotoInput = {
  reason: string;
};

export type PhotoApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SITE_INACTIVE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'STORAGE_NOT_CONFIGURED'
  | 'STORAGE_SIGNED_URL_FAILED'
  | 'UPLOAD_FAILED'
  | 'DELETE_FAILED'
  | 'INTERNAL_ERROR';
