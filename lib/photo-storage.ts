import { randomUUID } from 'node:crypto';
import {
  createSignedStorageUrl,
  getSignedStorageUrlTtlSeconds,
  removePrivateStorageObject,
  uploadPrivateStorageObject,
} from '@/lib/storage';

export function generatePhotoStorageKey(payload: {
  siteId: string;
  userId: string;
  filename: string;
  timestamp?: Date;
}) {
  const safeFileName = payload.filename.replace(/[^\w.-]+/g, '_');
  const instant = payload.timestamp ?? new Date();
  const timestampLabel = instant.toISOString().replace(/[:.]/g, '-');
  return `${payload.siteId}/${payload.userId}/${timestampLabel}_${randomUUID()}_${safeFileName}`;
}

export async function uploadPrivatePhotoObject(payload: {
  storageKey: string;
  body: Buffer;
  contentType: string;
}) {
  return uploadPrivateStorageObject(payload);
}

export async function createSignedPhotoUrl(storageKey: string) {
  return createSignedStorageUrl(storageKey);
}

export async function removePrivatePhotoObject(storageKey: string) {
  return removePrivateStorageObject(storageKey);
}

export function getSignedPhotoUrlTtlSeconds() {
  return getSignedStorageUrlTtlSeconds();
}
