export {
  buildPhotoFormData,
  countPendingMobilePhotos,
  createOfflineId as createPendingPhotoId,
  enqueuePendingMobilePhoto,
  type PendingMobilePhoto,
} from '@/lib/mobile-offline-db';
import { syncMobileOfflineQueue } from '@/lib/mobile-offline-db';

export async function syncPendingMobilePhotos() {
  await syncMobileOfflineQueue({ mode: 'auto' });
}
