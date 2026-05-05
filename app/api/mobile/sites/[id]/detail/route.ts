import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createInternalPhotoUrl } from '@/lib/photos';
import { Role } from '@prisma/client';

export const GET = withAuth(async ({ user, params }) => {
  const allowedRoles = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
  
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = params;

  try {
    // Construire la clause where selon le rôle
    const whereClause: any = {
      id: id as string,
    };

    if (user.role === Role.PROJECT_MANAGER) {
      whereClause.project = {
        projectManagerId: user.id,
      };
    }

    // Récupérer les détails du chantier
    const site = await prisma.site.findFirst({
      where: whereClause,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectManager: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        teams: {
          where: {
            status: 'ACTIVE',
          },
          include: {
            members: {
              where: {
                status: 'ACTIVE',
              },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
        photos: {
          where: {
            isDeleted: false,
          },
          include: {
            uploadedBy: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            takenAt: 'desc',
          },
          take: 20, // Limiter pour la vue mobile
        },
        clockInRecords: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            arrivalAt: 'desc',
          },
          take: 50, // Limiter pour la vue mobile
        },
        _count: {
          select: {
            photos: {
              where: {
                isDeleted: false,
              },
            },
            clockInRecords: true,
          },
        },
      },
    });

    if (!site) {
      return Response.json(
        { code: 'SITE_NOT_FOUND', message: 'Chantier non trouvé' },
        { status: 404 }
      );
    }

    // Formater les données
    const formattedSite = {
      id: site.id,
      name: site.name,
      address: site.address,
      status: site.status,
      project: site.project,
      teams: site.teams.map(team => ({
        id: team.id,
        name: team.name,
        members: team.members.map(member => ({
          id: member.user.id,
          firstName: member.user.firstName,
          lastName: member.user.lastName,
          role: member.user.role,
        })),
      })),
      photos: site.photos.map(photo => ({
        id: photo.id,
        filename: photo.filename,
        url: createInternalPhotoUrl(photo.id),
        takenAt: photo.takenAt.toISOString(),
        author: {
          firstName: photo.uploadedBy.firstName,
          lastName: photo.uploadedBy.lastName,
        },
      })),
      clockInRecords: site.clockInRecords.map(record => ({
        id: record.id,
        arrivalAt: record.arrivalAt.toISOString(),
        departureAt: record.departureAt?.toISOString() || null,
        user: {
          firstName: record.user.firstName,
          lastName: record.user.lastName,
        },
      })),
      _count: site._count,
    };

    return Response.json(formattedSite);
  } catch (error) {
    console.error('Mobile site detail error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des détails du chantier' },
      { status: 500 }
    );
  }
});
