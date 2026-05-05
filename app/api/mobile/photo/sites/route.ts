import { ClockInStatus, ClockInType, Role, SiteStatus, TeamMemberStatus, TeamStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canUploadPhotos, jsonPhotoError } from '@/lib/photos';
import type { MobilePhotoSiteOption } from '@/types/mobile-photo';

const fieldRoles: readonly Role[] = [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR];
const mobilePhotoSiteRoles: readonly Role[] = [
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
];

export const GET = withAuth(async ({ user }) => {
  if (!canUploadPhotos(user.role) || !mobilePhotoSiteRoles.includes(user.role)) {
    return jsonPhotoError('FORBIDDEN', 403, 'Accès refusé aux sites photo mobile.');
  }

  const sites = await prisma.site.findMany({
    where: getSiteWhere(user),
    select: {
      id: true,
      name: true,
      address: true,
      project: {
        select: {
          name: true,
        },
      },
      clockInRecords: {
        where: {
          userId: user.id,
          status: ClockInStatus.VALID,
          type: {
            in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE],
          },
        },
        orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          type: true,
        },
      },
    },
    orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
  });

  const items: MobilePhotoSiteOption[] = sites.map((site) => ({
    id: site.id,
    name: site.name,
    address: site.address,
    projectName: site.project.name,
    hasOpenSession: hasOpenSession(site.clockInRecords),
  }));

  return Response.json({ items });
});

function getSiteWhere(user: { id: string; role: Role }) {
  if (fieldRoles.includes(user.role)) {
    return {
      status: SiteStatus.ACTIVE,
      teams: {
        some: {
          status: TeamStatus.ACTIVE,
          members: {
            some: {
              userId: user.id,
              status: TeamMemberStatus.ACTIVE,
            },
          },
        },
      },
    };
  }

  if (user.role === Role.PROJECT_MANAGER) {
    return {
      status: SiteStatus.ACTIVE,
      project: {
        projectManagerId: user.id,
      },
    };
  }

  return {
    status: SiteStatus.ACTIVE,
  };
}

function hasOpenSession(records: { type: ClockInType }[]) {
  let open = false;

  for (const record of records) {
    if (record.type === ClockInType.ARRIVAL) {
      open = true;
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      open = false;
    }
  }

  return open;
}
