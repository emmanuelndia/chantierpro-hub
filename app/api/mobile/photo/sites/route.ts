import { ClockInStatus, ClockInType, PlanningWorkLocationType, Role, SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canUploadPhotos, jsonPhotoError } from '@/lib/photos';
import { FIELD_USER_ROLES } from '@/lib/field-roles';
import type { MobilePhotoSiteOption } from '@/types/mobile-photo';

const mobilePhotoSiteRoles: readonly Role[] = [
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.BE_RESOURCE,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];

export const GET = withAuth(async ({ user }) => {
  if (!canUploadPhotos(user.role) || !mobilePhotoSiteRoles.includes(user.role)) {
    return jsonPhotoError('FORBIDDEN', 403, 'Accès refusé aux sites photo mobile.');
  }

  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const sites = await prisma.site.findMany({
    where: getSiteWhere(user, today),
    select: {
      id: true,
      name: true,
      address: true,
      project: {
        select: {
          name: true,
        },
      },
      planningAssignments: {
        where: {
          supervisorId: user.id,
          date: today,
          deletedAt: null,
          workLocationType: PlanningWorkLocationType.ON_SITE,
        },
        select: {
          id: true,
        },
      },
      clockInRecords: {
        where: {
          userId: user.id,
          clockInDate: today,
          status: ClockInStatus.VALID,
        },
        orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          type: true,
        },
      },
    },
    orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
  });

  const items: MobilePhotoSiteOption[] = sites.flatMap((site) => {
    const hasOpen = hasOpenSession(site.clockInRecords);

    if (FIELD_USER_ROLES.includes(user.role) && site.planningAssignments.length === 0 && !hasOpen) {
      return [];
    }

    return [{
      id: site.id,
      name: site.name,
      address: site.address,
      projectName: site.project.name,
      hasOpenSession: hasOpen,
    }];
  });

  return Response.json({ items });
});

function getSiteWhere(user: { id: string; role: Role }, today: Date) {
  if (FIELD_USER_ROLES.includes(user.role)) {
    return {
      OR: [
        {
          status: SiteStatus.ACTIVE,
          planningAssignments: {
            some: {
              supervisorId: user.id,
              date: today,
              deletedAt: null,
              workLocationType: PlanningWorkLocationType.ON_SITE,
            },
          },
        },
        {
          clockInRecords: {
            some: {
              userId: user.id,
              clockInDate: today,
              status: ClockInStatus.VALID,
            },
          },
        },
      ],
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
    if (record.type === ClockInType.DEPARTURE) {
      open = false;
      continue;
    }

    open = true;
  }

  return open;
}
