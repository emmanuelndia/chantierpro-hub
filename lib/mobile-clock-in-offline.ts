import {
  createOfflineId,
  enqueueOfflineClockIn as enqueueClockIn,
  enqueueOfflineComment as enqueueComment,
  enqueueOfflineReport as enqueueReport,
  getMobileOfflinePendingCounts,
  type OfflineClockInItem,
  type OfflineCommentItem,
  type OfflineReportItem,
} from '@/lib/mobile-offline-db';

export type { OfflineClockInItem, OfflineCommentItem, OfflineReportItem };

export function createOfflineClockInId() {
  return createOfflineId();
}

export async function enqueueOfflineClockIn(item: OfflineClockInItem) {
  await enqueueClockIn(item);
}

export async function enqueueOfflineComment(item: OfflineCommentItem) {
  await enqueueComment(item);
}

export async function enqueueOfflineReport(item: Omit<OfflineReportItem, 'timestampLocal' | 'clockInClientId'>) {
  await enqueueReport({
    ...item,
    clockInClientId: item.clientId,
    timestampLocal: new Date().toISOString(),
  });
}

export async function getMobileClockInPendingCount() {
  const counts = await getMobileOfflinePendingCounts();
  return counts.clockIns + counts.comments + counts.reports;
}
