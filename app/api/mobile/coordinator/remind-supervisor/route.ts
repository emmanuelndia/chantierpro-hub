import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';

type ReminderBody = {
  supervisorId?: string;
  reportId?: string;
};

export const POST = withAuth(async ({ user, req }) => {
  if (user.role !== Role.COORDINATOR) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as ReminderBody | null;
  const supervisorId = body?.supervisorId;
  const reportId = body?.reportId;

  if (!supervisorId || !reportId) {
    return Response.json(
      { code: 'INVALID_REQUEST', message: 'Paramètres manquants' },
      { status: 400 },
    );
  }

  try {
    const siteIds = await getOperationalSiteIds(prisma, user.id);
    const supervisor = await prisma.user.findFirst({
      where: {
        id: supervisorId,
        role: { in: [Role.SUPERVISOR, Role.RESOURCE] },
        isActive: true,
        OR: [
          {
            teamMemberships: {
              some: {
                status: 'ACTIVE',
                team: {
                  siteId: { in: siteIds },
                  status: 'ACTIVE',
                },
              },
            },
          },
          {
            clockInRecords: {
              some: {
                siteId: { in: siteIds },
              },
            },
          },
        ],
      },
      select: {
        firstName: true,
        lastName: true,
      },
    });

    if (!supervisor) {
      return Response.json(
        { code: 'FORBIDDEN', message: "Ce superviseur n'est pas dans votre périmètre" },
        { status: 403 },
      );
    }

    return Response.json({
      success: true,
      message: `Rappel préparé pour ${supervisor.firstName} ${supervisor.lastName}`,
    });
  } catch (error) {
    console.error('Remind supervisor error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: "Erreur lors de l'envoi du rappel" },
      { status: 500 },
    );
  }
});
