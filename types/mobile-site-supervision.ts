import type { PhotoTag, SiteGeofenceType, SiteStatus } from '@prisma/client';
import type { SiteGeofencePolygon } from '@/types/projects';

export type MobileSitePresenceStatus = 'PRESENT' | 'PAUSED' | 'ABSENT';

export type MobileSiteSupervisionSite = {
  id: string;
  name: string;
  address: string;
  status: SiteStatus;
  latitude: number;
  longitude: number;
  radiusKm: number;
  geofenceType: SiteGeofenceType;
  geofencePolygon: SiteGeofencePolygon | null;
  projectName: string;
};

export type MobileSitePresenceItem = {
  userId: string;
  name: string;
  role: string;
  status: MobileSitePresenceStatus;
  presentSince: string | null;
  pauseSince: string | null;
  lastClockInAt: string | null;
};

export type MobileSitePhotoItem = {
  id: string;
  filename: string;
  url: string | null;
  uploadedByName: string;
  timestampLocal: string;
  tags: PhotoTag[];
  description: string | null;
  planningAssignmentId: string | null;
  assignmentAction: string | null;
};

export type MobileSiteReportItem = {
  id: string;
  authorName: string;
  submittedAt: string;
  content: string;
};

export type MobileSiteSupervisionResponse = {
  site: MobileSiteSupervisionSite;
  presence: {
    date: string;
    items: MobileSitePresenceItem[];
  };
  photos: MobileSitePhotoItem[];
  reports: MobileSiteReportItem[];
  permissions: {
    canLogVisit: boolean;
    canViewOperations: boolean;
  };
};
