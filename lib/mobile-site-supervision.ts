import {
  ClockInStatus,
  ClockInType,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import { createInternalPhotoUrl } from '@/lib/photos';
import { getOperationalSiteIds } from '@/lib/dashboard';
import type {
  MobileSitePhotoItem,
  MobileSitePresenceItem,
  MobileSitePresenceStatus,
  MobileSiteReportItem,
  MobileSiteSupervisionResponse,
} from '@/types/mobile-site-supervision';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type PresenceRecord = {
  userId: string;
  type: ClockInType;
  status: ClockInStatus;
  timestampLocal: Date;
};

const MOBILE_SITE_SUPERVISION_ROLES: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
];

export function canAccessMobileSiteSupervision(role: Role) {
  return MOBILE_SITE_SUPERVISION_ROLES.includes(role);
}

export async function getMobileSiteSupervision(
  prisma: PrismaClient,
  user: AuthLikeUser,
  siteId: string,
): Promise<MobileSiteSupervisionResponse | null> {
  if (!canAccessMobileSiteSupervision(user.role)) {
    return null;
  }

  const scopedSite = await getScopedSupervisionSite(prisma, user, siteId);

  if (!scopedSite) {
    return null;
  }

  const today = toDateOnlyDate(new Date());
  const [members, records, photos, reports] = await Promise.all([
    prisma.teamMember.findMany({
      where: {
        status: TeamMemberStatus.ACTIVE,
        user: {
          isActive: true,
        },
        team: {
          siteId,
          status: TeamStatus.ACTIVE,
        },
      },
      select: {
        userId: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
      orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }, { userId: 'asc' }],
    }),
    prisma.clockInRecord.findMany({
      where: {
        siteId,
        clockInDate: today,
        status: ClockInStatus.VALID,
      },
      orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        userId: true,
        type: true,
        status: true,
        timestampLocal: true,
      },
    }),
    prisma.photo.findMany({
      where: {
        siteId,
        isDeleted: false,
      },
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      take: 30,
      select: {
        id: true,
        filename: true,
        storageKey: true,
        timestampLocal: true,
        uploadedBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
    prisma.report.findMany({
      where: {
        siteId,
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 30,
      select: {
        id: true,
        content: true,
        submittedAt: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
  ]);

  return {
    site: {
      id: scopedSite.id,
      name: scopedSite.name,
      address: scopedSite.address,
      status: scopedSite.status,
      latitude: scopedSite.latitude.toNumber(),
      longitude: scopedSite.longitude.toNumber(),
      radiusKm: scopedSite.radiusKm.toNumber(),
      projectName: scopedSite.project.name,
    },
    presence: {
      date: today.toISOString().slice(0, 10),
      items: serializePresenceItems(members, records),
    },
    photos: photos.map(serializePhoto),
    reports: reports.map(serializeReport),
  };
}

async function getScopedSupervisionSite(prisma: PrismaClient, user: AuthLikeUser, siteId: string) {
  if (user.role === Role.COORDINATOR || user.role === Role.GENERAL_SUPERVISOR) {
    const siteIds = await getOperationalSiteIds(prisma, user.id);

    if (!siteIds.includes(siteId)) {
      return null;
    }
  }

  return prisma.site.findFirst({
    where: {
      id: siteId,
      status: SiteStatus.ACTIVE,
      ...(user.role === Role.PROJECT_MANAGER
        ? {
            project: {
              projectManagerId: user.id,
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      address: true,
      status: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      project: {
        select: {
          name: true,
        },
      },
    },
  });
}

function serializePresenceItems(
  members: {
    userId: string;
    user: {
      firstName: string;
      lastName: string;
      role: Role;
    };
  }[],
  records: PresenceRecord[],
): MobileSitePresenceItem[] {
  const uniqueMembers = new Map<string, (typeof members)[number]>();

  for (const member of members) {
    uniqueMembers.set(member.userId, member);
  }

  return [...uniqueMembers.values()].map((member) => {
    const userRecords = records.filter((record) => record.userId === member.userId);
    const state = getPresenceState(userRecords);

    return {
      userId: member.userId,
      name: `${member.user.firstName} ${member.user.lastName}`,
      role: member.user.role,
      status: state.status,
      presentSince: state.presentSince?.toISOString() ?? null,
      pauseSince: state.pauseSince?.toISOString() ?? null,
      lastClockInAt: userRecords.at(-1)?.timestampLocal.toISOString() ?? null,
    };
  });
}

function getPresenceState(records: PresenceRecord[]): {
  status: MobileSitePresenceStatus;
  presentSince: Date | null;
  pauseSince: Date | null;
} {
  let presentSince: Date | null = null;
  let pauseSince: Date | null = null;

  for (const record of records) {
    if (record.type === ClockInType.ARRIVAL) {
      presentSince = record.timestampLocal;
      pauseSince = null;
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      presentSince = null;
      pauseSince = null;
      continue;
    }

    if (record.type === ClockInType.PAUSE_START && presentSince) {
      pauseSince = record.timestampLocal;
      continue;
    }

    if (record.type === ClockInType.PAUSE_END) {
      pauseSince = null;
    }
  }

  if (pauseSince) {
    return {
      status: 'PAUSED',
      presentSince,
      pauseSince,
    };
  }

  if (presentSince) {
    return {
      status: 'PRESENT',
      presentSince,
      pauseSince: null,
    };
  }

  return {
    status: 'ABSENT',
    presentSince: null,
    pauseSince: null,
  };
}

function serializePhoto(photo: {
  id: string;
  filename: string;
  storageKey: string;
  timestampLocal: Date;
  uploadedBy: {
    firstName: string;
    lastName: string;
  };
}): MobileSitePhotoItem {
  return {
    id: photo.id,
    filename: photo.filename,
    url: createInternalPhotoUrl(photo.id),
    uploadedByName: `${photo.uploadedBy.firstName} ${photo.uploadedBy.lastName}`,
    timestampLocal: photo.timestampLocal.toISOString(),
  };
}

function serializeReport(report: {
  id: string;
  content: string;
  submittedAt: Date;
  user: {
    firstName: string;
    lastName: string;
  };
}): MobileSiteReportItem {
  return {
    id: report.id,
    authorName: `${report.user.firstName} ${report.user.lastName}`,
    submittedAt: report.submittedAt.toISOString(),
    content: report.content,
  };
}

function toDateOnlyDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
