import type { ClockInType, OfficeClockInLocation, PhotoTag } from '@prisma/client';
import { authFetch } from '@/lib/auth/client-session';
import type { BatchSyncItemResult, ClockInInput } from '@/types/clock-in';

const DB_NAME = 'chantierpro-mobile-offline';
const DB_VERSION = 2;
const LEGACY_CLOCK_IN_STORAGE_KEY = 'chantierpro:mobile-clock-in-offline:v1';
const LEGACY_MIGRATION_KEY = 'chantierpro:mobile-offline:migrated-clock-ins:v1';
const LEGACY_PHOTO_DB_NAME = 'chantierpro-mobile-photo';
const LEGACY_PHOTO_STORE_NAME = 'pending-photos';
const LEGACY_PHOTO_MIGRATION_KEY = 'chantierpro:mobile-offline:migrated-photos:v1';
const SYNC_LOG_LIMIT = 12;
const PHOTO_BATCH_SIZE = 5;

type StoreName =
  | 'clockIns'
  | 'comments'
  | 'photos'
  | 'reports'
  | 'sessionReports'
  | 'taskUpdates'
  | 'cache'
  | 'syncLogs'
  | 'clientMappings';

export type OfflineClockInItem = ClockInInput & {
  clientId: string;
  siteName: string;
  siteId?: string | null;
  freeMissionId?: string | null;
  officeLocationId?: string | null;
  officeClockInLocation?: OfficeClockInLocation | null;
  planningAssignmentId?: string | null;
};

export type OfflineCommentItem = {
  clientId: string;
  comment: string;
};

export type OfflineReportItem = {
  clientId: string;
  siteId: string;
  content: string;
  clockInRecordId?: string;
  clockInClientId?: string;
  timestampLocal?: string;
};

export type OfflineSessionReportItem = {
  clientId: string;
  clockInRecordId?: string;
  content: string;
  progressPercentage: number;
  blockageNote?: string;
  assignmentId?: string;
  timestampLocal?: string;
};

export type OfflineTaskUpdateItem = {
  id: string;
  assignmentId?: string;
  status?: 'COMPLETED';
  progress?: number | null;
  actualQuantity?: number | null;
  comment?: string | null;
  blocked?: boolean;
  completed?: boolean;
  timestampLocal?: string;
};

export type PendingMobilePhoto = {
  id: string;
  blob: Blob;
  filename: string;
  siteId?: string | null;
  freeMissionId?: string | null;
  negotiationAssignmentId?: string | null;
  planningAssignmentId?: string | null;
  description?: string;
  tags?: PhotoTag[];
  timestampLocal?: string;
  latitude: number | null;
  longitude: number | null;
};

export type MobileOfflineCacheItem<T = unknown> = {
  key: string;
  payload: T;
  updatedAt: string;
  expiresAt: string | null;
};

export type MobileOfflineSyncLog = {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: 'auto' | 'manual';
  status: 'success' | 'partial' | 'error';
  counts: MobileOfflinePendingCounts;
  errors: string[];
};

export type MobileOfflinePendingCounts = {
  clockIns: number;
  comments: number;
  photos: number;
  reports: number;
  sessionReports: number;
  taskUpdates: number;
};

type ClientMapping = {
  clockInClientId?: string;
  serverRecordId: string;
};

type LegacyReportItem = Omit<OfflineReportItem, 'timestampLocal'> & {
  timestampLocal?: string;
};

type LegacyQueue = {
  clockIns?: OfflineClockInItem[];
  comments?: OfflineCommentItem[];
  reports?: LegacyReportItem[];
};

let syncInFlight: Promise<MobileOfflineSyncLog> | null = null;

export function createOfflineId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueOfflineClockIn(item: OfflineClockInItem) {
  await migrateLegacyClockInQueue();
  const db = await openDb();
  await storeRequest(db, 'clockIns', 'readwrite', (store) => store.put(item));
  db.close();
}

export async function enqueueOfflineComment(item: OfflineCommentItem) {
  await migrateLegacyClockInQueue();
  const db = await openDb();
  await storeRequest(db, 'comments', 'readwrite', (store) => store.put(item));
  db.close();
}

export async function enqueueOfflineReport(item: OfflineReportItem) {
  await migrateLegacyClockInQueue();
  const db = await openDb();
  await storeRequest(db, 'reports', 'readwrite', (store) => store.put(item));
  db.close();
}

export async function enqueueOfflineSessionReport(item: OfflineSessionReportItem) {
  const db = await openDb();
  await storeRequest(db, 'sessionReports', 'readwrite', (store) => store.put(item));
  db.close();
}

export async function enqueueOfflineTaskUpdate(item: OfflineTaskUpdateItem) {
  const db = await openDb();
  await storeRequest(db, 'taskUpdates', 'readwrite', (store) => store.put(item));
  db.close();
}

export async function enqueuePendingMobilePhoto(photo: PendingMobilePhoto) {
  const db = await openDb();
  await storeRequest(db, 'photos', 'readwrite', (store) => store.put(photo));
  db.close();
}

export async function getMobileOfflinePendingCounts(): Promise<MobileOfflinePendingCounts> {
  await migrateLegacyClockInQueue();
  await migrateLegacyPhotoQueue();
  const db = await openDb();
  const [clockIns, comments, photos, reports, sessionReports, taskUpdates] = await Promise.all([
    storeRequest<number>(db, 'clockIns', 'readonly', (store) => store.count()),
    storeRequest<number>(db, 'comments', 'readonly', (store) => store.count()),
    storeRequest<number>(db, 'photos', 'readonly', (store) => store.count()),
    storeRequest<number>(db, 'reports', 'readonly', (store) => store.count()),
    storeRequest<number>(db, 'sessionReports', 'readonly', (store) => store.count()),
    storeRequest<number>(db, 'taskUpdates', 'readonly', (store) => store.count()),
  ]);
  db.close();
  return { clockIns, comments, photos, reports, sessionReports, taskUpdates };
}

export async function getPendingOfflineClockIns() {
  await migrateLegacyClockInQueue();
  const db = await openDb();
  const items = await getAll<OfflineClockInItem>(db, 'clockIns');
  db.close();
  return items.sort((left, right) => left.timestampLocal.localeCompare(right.timestampLocal));
}

export async function countPendingMobilePhotos() {
  return (await getMobileOfflinePendingCounts()).photos;
}

export async function getMobileOfflineSyncLogs() {
  const db = await openDb();
  const logs = await getAll<MobileOfflineSyncLog>(db, 'syncLogs');
  db.close();
  return logs.sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, SYNC_LOG_LIMIT);
}

export async function setMobileOfflineCache<T>(key: string, payload: T, ttlMs: number | null = null) {
  const now = Date.now();
  const item: MobileOfflineCacheItem<T> = {
    key,
    payload,
    updatedAt: new Date(now).toISOString(),
    expiresAt: ttlMs === null ? null : new Date(now + ttlMs).toISOString(),
  };
  const db = await openDb();
  await storeRequest(db, 'cache', 'readwrite', (store) => store.put(item));
  db.close();
}

export async function getMobileOfflineCache<T>(key: string): Promise<MobileOfflineCacheItem<T> | null> {
  const db = await openDb();
  const item = await storeRequest<MobileOfflineCacheItem<T> | undefined>(db, 'cache', 'readonly', (store) =>
    store.get(key) as IDBRequest<MobileOfflineCacheItem<T> | undefined>,
  );
  db.close();

  if (!item) {
    return null;
  }

  if (item.expiresAt && new Date(item.expiresAt).getTime() < Date.now()) {
    return null;
  }

  return item;
}

export async function removeMobileOfflineCache(key: string) {
  const db = await openDb();
  await storeRequest(db, 'cache', 'readwrite', (store) => store.delete(key));
  db.close();
}

export async function syncMobileOfflineQueue({ mode }: { mode: 'auto' | 'manual' }) {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = runSync(mode).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export function buildPhotoFormData(photo: PendingMobilePhoto) {
  const formData = new FormData();
  formData.set('file', new File([photo.blob], photo.filename, { type: photo.blob.type || 'image/jpeg' }));
  if (photo.siteId) {
    formData.set('siteId', photo.siteId);
  }
  if (photo.freeMissionId) {
    formData.set('freeMissionId', photo.freeMissionId);
  }
  if (photo.negotiationAssignmentId) {
    formData.set('negotiationAssignmentId', photo.negotiationAssignmentId);
  }
  formData.set('category', 'PROGRESS');
  formData.set('description', photo.description ?? '');
  formData.set('tags', JSON.stringify(photo.tags ?? []));
  formData.set('timestampLocal', photo.timestampLocal ?? new Date().toISOString());

  if (photo.planningAssignmentId) {
    formData.set('planningAssignmentId', photo.planningAssignmentId);
  }

  if (photo.latitude !== null) {
    formData.set('lat', String(photo.latitude));
  }

  if (photo.longitude !== null) {
    formData.set('lng', String(photo.longitude));
  }

  return formData;
}

async function runSync(mode: 'auto' | 'manual'): Promise<MobileOfflineSyncLog> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  await migrateLegacyClockInQueue();
  await migrateLegacyPhotoQueue();
  const countsBefore = await getMobileOfflinePendingCounts();

  try {
    await syncClockIns(errors);
    await syncReports(errors);
    await syncPhotos(errors);
    await syncSessionReports(errors);
    await syncTaskUpdates(errors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Synchronisation interrompue.');
  }

  const countsAfter = await getMobileOfflinePendingCounts();
  const pendingAfter =
    countsAfter.clockIns +
    countsAfter.comments +
    countsAfter.photos +
    countsAfter.reports +
    countsAfter.sessionReports +
    countsAfter.taskUpdates;
  const status: MobileOfflineSyncLog['status'] =
    errors.length === 0 && pendingAfter === 0 ? 'success' : errors.length > 0 ? 'error' : 'partial';

  const log: MobileOfflineSyncLog = {
    id: createOfflineId(),
    startedAt,
    finishedAt: new Date().toISOString(),
    mode,
    status,
    counts: countsBefore,
    errors,
  };

  await appendSyncLog(log);
  return log;
}

async function syncClockIns(errors: string[]) {
  const db = await openDb();
  const [clockIns, comments] = await Promise.all([
    getAll<OfflineClockInItem>(db, 'clockIns'),
    getAll<OfflineCommentItem>(db, 'comments'),
  ]);
  db.close();

  if (clockIns.length === 0) {
    return;
  }

  const sortedClockIns = clockIns.sort(
    (left, right) => new Date(left.timestampLocal).getTime() - new Date(right.timestampLocal).getTime(),
  );
  const siteClockIns = sortedClockIns.filter((item): item is OfflineClockInItem & { siteId: string } => Boolean(item.siteId));
  const contextualClockIns = sortedClockIns.filter((item) => !item.siteId);
  const nextDb = await openDb();

  if (siteClockIns.length > 0) {
    const response = await authFetch('/api/sync/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: siteClockIns.map((item) => ({
          siteId: item.siteId,
          type: item.type,
          latitude: item.latitude,
          longitude: item.longitude,
          accuracy: item.accuracy,
          timestampLocal: item.timestampLocal,
          comment: item.comment ?? null,
        })),
      }),
    });

    if (!response.ok) {
      errors.push('Synchronisation des pointages chantier refusee.');
    } else {
      const payload = (await response.json()) as { items: BatchSyncItemResult[] };

      for (let index = 0; index < payload.items.length; index += 1) {
        const result = payload.items[index];
        const source = siteClockIns[index];
        if (!result || !source) {
          continue;
        }
        await syncClockInResult({
          comments,
          db: nextDb,
          errors,
          result,
          source,
        });
      }
    }
  }

  for (const source of contextualClockIns) {
    const response = await syncContextualClockIn(source);

    if (!response.ok) {
      errors.push(response.message);
      continue;
    }

    await syncClockInResult({
      comments,
      db: nextDb,
      errors,
      result: {
        status: response.status ?? 'VALID',
        recordId: response.recordId,
      },
      source,
    });
  }

  nextDb.close();
}

async function syncContextualClockIn(item: OfflineClockInItem): Promise<{
  ok: boolean;
  message: string;
  recordId?: string;
  status?: BatchSyncItemResult['status'];
}> {
  const payload = {
    type: item.type,
    latitude: item.latitude,
    longitude: item.longitude,
    accuracy: item.accuracy,
    timestampLocal: item.timestampLocal,
    comment: item.comment ?? null,
  };

  if (item.officeLocationId) {
    const response = await authFetch('/api/office-clock-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        officeLocationId: item.officeLocationId,
        officeClockInLocation: item.officeClockInLocation ?? 'OFFICE',
        planningAssignmentId: item.planningAssignmentId ?? null,
      }),
    });

    if (!response.ok) {
      return { ok: false, message: 'Synchronisation du pointage bureau refusee.' };
    }

    const data = (await response.json()) as { record: { id: string; status: BatchSyncItemResult['status'] } };
    return { ok: true, message: '', recordId: data.record.id, status: data.record.status };
  }

  if (item.freeMissionId) {
    const response = await authFetch(`/api/free-missions/${item.freeMissionId}/clock-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { ok: false, message: 'Synchronisation du pointage zone refusee.' };
    }

    const data = (await response.json()) as { record: { id: string; status: BatchSyncItemResult['status'] } };
    return { ok: true, message: '', recordId: data.record.id, status: data.record.status };
  }

  return { ok: false, message: 'Pointage offline sans contexte exploitable.' };
}

async function syncClockInResult(payload: {
  db: IDBDatabase;
  source: OfflineClockInItem;
  result: {
    message?: string | undefined;
    recordId?: string | undefined;
    status?: BatchSyncItemResult['status'] | undefined;
  };
  comments: OfflineCommentItem[];
  errors: string[];
}) {
  const { db, source, result, comments, errors } = payload;
  const recordId = result.recordId;

  if (!recordId) {
    if (result.message) {
      errors.push(result.message);
    }
    return;
  }

  await storeRequest(db, 'clientMappings', 'readwrite', (store) =>
    store.put({ clockInClientId: source.clientId, serverRecordId: recordId } satisfies ClientMapping),
  );
  await storeRequest(db, 'clockIns', 'readwrite', (store) => store.delete(source.clientId));

  const comment = comments.find((item) => item.clientId === source.clientId);
  if (comment) {
    const commentResponse = await authFetch(`/api/clock-in/${recordId}/comment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: comment.comment }),
    });

    if (commentResponse.ok) {
      await storeRequest(db, 'comments', 'readwrite', (store) => store.delete(comment.clientId));
    } else {
      errors.push('Commentaire en attente non synchronise.');
    }
  }

  if (result.status === 'ANOMALY' && result.message) {
    errors.push(result.message);
  }
}

async function syncReports(errors: string[]) {
  const db = await openDb();
  const [reports, mappings] = await Promise.all([
    getAll<OfflineReportItem>(db, 'reports'),
    getAll<ClientMapping>(db, 'clientMappings'),
  ]);
  db.close();

  const mappingByClientId = new Map(mappings.map((mapping) => [mapping.clockInClientId, mapping.serverRecordId]));

  for (const report of reports.sort((left, right) => (left.timestampLocal ?? '').localeCompare(right.timestampLocal ?? ''))) {
    const clockInRecordId =
      report.clockInRecordId ?? (report.clockInClientId ? mappingByClientId.get(report.clockInClientId) : null);

    if (!clockInRecordId) {
      continue;
    }

    const response = await authFetch(`/api/sites/${report.siteId}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: report.content, clockInRecordId }),
    });

    if (response.ok || response.status === 409) {
      const nextDb = await openDb();
      await storeRequest(nextDb, 'reports', 'readwrite', (store) => store.delete(report.clientId));
      nextDb.close();
    } else {
      errors.push('Rapport en attente non synchronise.');
    }
  }
}

async function syncPhotos(errors: string[]) {
  const db = await openDb();
  const photos = (await getAll<PendingMobilePhoto>(db, 'photos'))
    .sort((left, right) => (left.timestampLocal ?? '').localeCompare(right.timestampLocal ?? ''))
    .slice(0, PHOTO_BATCH_SIZE);
  db.close();

  for (const photo of photos) {
    const response = await authFetch('/api/photos', {
      method: 'POST',
      body: buildPhotoFormData(photo),
    });

    if (response.ok) {
      const nextDb = await openDb();
      await storeRequest(nextDb, 'photos', 'readwrite', (store) => store.delete(photo.id));
      nextDb.close();
    } else {
      errors.push('Photo en attente non synchronisee.');
    }
  }
}

async function syncSessionReports(errors: string[]) {
  const db = await openDb();
  const reports = await getAll<OfflineSessionReportItem>(db, 'sessionReports');
  db.close();

  for (const report of reports.sort((left, right) => (left.timestampLocal ?? '').localeCompare(right.timestampLocal ?? ''))) {
    const response = await authFetch('/api/mobile/session-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });

    if (response.ok || response.status === 409) {
      const nextDb = await openDb();
      await storeRequest(nextDb, 'sessionReports', 'readwrite', (store) => store.delete(report.clientId));
      nextDb.close();
    } else {
      errors.push('Rapport de session en attente non synchronise.');
    }
  }
}

async function syncTaskUpdates(errors: string[]) {
  const db = await openDb();
  const updates = await getAll<OfflineTaskUpdateItem>(db, 'taskUpdates');
  db.close();

  for (const update of updates.sort((left, right) => (left.timestampLocal ?? '').localeCompare(right.timestampLocal ?? ''))) {
    const isProgressUpdate =
      update.progress !== undefined ||
      update.actualQuantity !== undefined ||
      update.comment !== undefined ||
      update.blocked !== undefined ||
      update.completed !== undefined;
    const response = await authFetch(
      isProgressUpdate
        ? `/api/mobile/planning/assignment/${update.assignmentId}/progress`
        : `/api/mobile/planning/assignment/${update.assignmentId}`,
      {
      method: isProgressUpdate ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isProgressUpdate
          ? {
              progress: update.progress,
              actualQuantity: update.actualQuantity,
              comment: update.comment,
              blocked: update.blocked,
              completed: update.completed,
            }
          : { status: update.status },
      ),
    },
    );

    if (response.ok) {
      const nextDb = await openDb();
      await storeRequest(nextDb, 'taskUpdates', 'readwrite', (store) => store.delete(update.id));
      nextDb.close();
    } else {
      errors.push('Mise a jour de tache en attente non synchronisee.');
    }
  }
}

async function appendSyncLog(log: MobileOfflineSyncLog) {
  const db = await openDb();
  await storeRequest(db, 'syncLogs', 'readwrite', (store) => store.put(log));
  const logs = await getAll<MobileOfflineSyncLog>(db, 'syncLogs');
  const staleLogs = logs
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(SYNC_LOG_LIMIT)
    .map((item) => item.id);

  for (const id of staleLogs) {
    await storeRequest(db, 'syncLogs', 'readwrite', (store) => store.delete(id));
  }

  db.close();
}

async function migrateLegacyClockInQueue() {
  if (typeof window === 'undefined' || window.localStorage.getItem(LEGACY_MIGRATION_KEY) === '1') {
    return;
  }

  const raw = window.localStorage.getItem(LEGACY_CLOCK_IN_STORAGE_KEY);

  if (!raw) {
    window.localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
    return;
  }

  try {
    const parsed = JSON.parse(raw) as LegacyQueue;
    const db = await openDb();

    for (const clockIn of Array.isArray(parsed.clockIns) ? parsed.clockIns.filter(isClockInItem) : []) {
      await storeRequest(db, 'clockIns', 'readwrite', (store) => store.put(clockIn));
    }

    for (const comment of Array.isArray(parsed.comments) ? parsed.comments.filter(isCommentItem) : []) {
      await storeRequest(db, 'comments', 'readwrite', (store) => store.put(comment));
    }

    for (const report of Array.isArray(parsed.reports) ? parsed.reports.filter(isLegacyReportItem) : []) {
      await storeRequest(db, 'reports', 'readwrite', (store) =>
        store.put({
          ...report,
          clockInClientId: report.clientId,
          timestampLocal: report.timestampLocal ?? new Date().toISOString(),
        } satisfies OfflineReportItem),
      );
    }

    db.close();
    window.localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
  } catch {
    window.localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
  }
}

async function migrateLegacyPhotoQueue() {
  if (typeof window === 'undefined' || window.localStorage.getItem(LEGACY_PHOTO_MIGRATION_KEY) === '1') {
    return;
  }

  try {
    const legacyDb = await openLegacyPhotoDb();
    const photos = await legacyStoreRequest<PendingMobilePhoto[]>(legacyDb, (store) =>
      store.getAll() as IDBRequest<PendingMobilePhoto[]>,
    );
    legacyDb.close();

    if (photos.length > 0) {
      const db = await openDb();

      for (const photo of photos) {
        await storeRequest(db, 'photos', 'readwrite', (store) => store.put(photo));
      }

      db.close();
    }

    window.localStorage.setItem(LEGACY_PHOTO_MIGRATION_KEY, '1');
  } catch {
    window.localStorage.setItem(LEGACY_PHOTO_MIGRATION_KEY, '1');
  }
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      ensureStore(db, 'clockIns', 'clientId');
      ensureStore(db, 'comments', 'clientId');
      ensureStore(db, 'photos', 'id');
      ensureStore(db, 'reports', 'clientId');
      ensureStore(db, 'sessionReports', 'clientId');
      ensureStore(db, 'taskUpdates', 'id');
      ensureStore(db, 'cache', 'key');
      ensureStore(db, 'syncLogs', 'id');
      ensureStore(db, 'clientMappings', 'clockInClientId');
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible.'));
  });
}

function openLegacyPhotoDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_PHOTO_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_PHOTO_STORE_NAME)) {
        db.createObjectStore(LEGACY_PHOTO_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB photos indisponible.'));
  });
}

function legacyStoreRequest<T>(db: IDBDatabase, createRequest: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(LEGACY_PHOTO_STORE_NAME, 'readonly');
    const request = createRequest(transaction.objectStore(LEGACY_PHOTO_STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Operation photos impossible.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Transaction photos impossible.'));
  });
}

function ensureStore(db: IDBDatabase, name: StoreName, keyPath: string) {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, { keyPath });
  }
}

function getAll<T>(db: IDBDatabase, storeName: StoreName) {
  return storeRequest<T[]>(db, storeName, 'readonly', (store) => store.getAll() as IDBRequest<T[]>);
}

function storeRequest<T>(
  db: IDBDatabase,
  storeName: StoreName,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Operation IndexedDB impossible.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Transaction IndexedDB impossible.'));
  });
}

function isClockInItem(value: unknown): value is OfflineClockInItem {
  return (
    isRecord(value) &&
    typeof value.clientId === 'string' &&
    typeof value.siteName === 'string' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    typeof value.timestampLocal === 'string' &&
    ((typeof value.siteId === 'string' && value.siteId.trim().length > 0) ||
      (typeof value.freeMissionId === 'string' && value.freeMissionId.trim().length > 0) ||
      (typeof value.officeLocationId === 'string' && value.officeLocationId.trim().length > 0)) &&
    isClockInType(value.type)
  );
}

function isCommentItem(value: unknown): value is OfflineCommentItem {
  return isRecord(value) && typeof value.clientId === 'string' && typeof value.comment === 'string';
}

function isLegacyReportItem(value: unknown): value is LegacyReportItem {
  return (
    isRecord(value) &&
    typeof value.clientId === 'string' &&
    typeof value.siteId === 'string' &&
    typeof value.content === 'string'
  );
}

function isClockInType(value: unknown): value is ClockInType {
  return (
    value === 'ARRIVAL' ||
    value === 'DEPARTURE' ||
    value === 'PAUSE_START' ||
    value === 'PAUSE_END' ||
    value === 'INTERMEDIATE'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
