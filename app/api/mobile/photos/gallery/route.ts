import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canUploadPhotos, createInternalPhotoUrl, jsonPhotoError, parsePhotoListQuery } from '@/lib/photos';
import type { PaginatedPhotosResponse } from '@/types/photos';

export const GET = withAuth(async ({ user, request }) => {
  if (!canUploadPhotos(user.role)) {
    return jsonPhotoError('FORBIDDEN', 403, "Accès refusé à la galerie photo mobile.");
  }

  const { searchParams } = new URL(request.url);
  const query = parsePhotoListQuery(searchParams);

  try {
    let photosResponse: PaginatedPhotosResponse | null = null;

    // Pour les rôles DIRECTION et ADMIN : tous les sites
    if (user.role === 'DIRECTION' || user.role === 'ADMIN') {
      // Récupérer toutes les photos de tous les sites actifs
      const where: any = {
        isDeleted: false,
        site: {
          status: 'ACTIVE',
        },
      };

      if (query.uploadedByIds.length > 0) {
        where.uploadedById = {
          in: query.uploadedByIds,
        };
      }

      if (query.category) {
        where.category = query.category;
      }

      if (query.from || query.to) {
        where.timestampLocal = {};
        if (query.from) {
          where.timestampLocal.gte = query.from;
        }
        if (query.to) {
          where.timestampLocal.lte = query.to;
        }
      }

      const [photos, totalItems, authorRows, siteRows] = await Promise.all([
        prisma.photo.findMany({
          where,
          orderBy: [{ timestampLocal: query.sort }, { id: query.sort }],
          skip: (query.page - 1) * 20,
          take: 20,
          select: {
            id: true,
            siteId: true,
            uploadedById: true,
            category: true,
            description: true,
            filename: true,
            fileSize: true,
            format: true,
            latitude: true,
            longitude: true,
            timestampLocal: true,
            takenAt: true,
            isDeleted: true,
            deletedAt: true,
            createdAt: true,
            uploadedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
            site: {
              select: {
                name: true,
              },
            },
          },
        }),
        prisma.photo.count({ where }),
        prisma.photo.findMany({
          where,
          distinct: ['uploadedById'],
          orderBy: [{ uploadedBy: { firstName: 'asc' } }, { uploadedBy: { lastName: 'asc' } }],
          select: {
            uploadedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
        }),
        prisma.site.findMany({
          where: {
            status: 'ACTIVE',
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: {
            name: 'asc',
          },
        }),
      ]);

      photosResponse = {
        items: photos.map((photo) => ({
          id: photo.id,
          siteId: photo.siteId,
          siteName: photo.site.name,
          uploadedById: photo.uploadedById,
          category: photo.category,
          description: photo.description,
          filename: photo.filename,
          fileSize: photo.fileSize,
          format: photo.format,
          latitude: photo.latitude?.toNumber() ?? null,
          longitude: photo.longitude?.toNumber() ?? null,
          timestampLocal: photo.timestampLocal.toISOString(),
          takenAt: photo.takenAt.toISOString(),
          isDeleted: photo.isDeleted,
          deletedAt: photo.deletedAt?.toISOString() ?? null,
          createdAt: photo.createdAt.toISOString(),
          author: {
            id: photo.uploadedBy.id,
            firstName: photo.uploadedBy.firstName,
            lastName: photo.uploadedBy.lastName,
            role: photo.uploadedBy.role,
          },
          url: createInternalPhotoUrl(photo.id),
        })),
        page: query.page,
        pageSize: 20,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / 20)),
        authors: authorRows.map((row) => row.uploadedBy),
        sites: siteRows,
      };
    }
    // Pour les PROJECT_MANAGER : seulement leurs projets
    else if (user.role === 'PROJECT_MANAGER') {
      const projectId = searchParams.get('projectId');
      
      if (!projectId) {
        // Récupérer les projets du manager
        const projects = await prisma.project.findMany({
          where: {
            projectManagerId: user.id,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            name: true,
          },
        });

        if (projects.length === 0) {
          return Response.json({
            items: [],
            page: 1,
            pageSize: 20,
            totalItems: 0,
            totalPages: 1,
            authors: [],
            sites: [],
          });
        }

        // Utiliser le premier projet par défaut
        const firstProject = projects[0];
        
        const where: any = {
          isDeleted: false,
          site: {
            projectId: firstProject.id,
            status: 'ACTIVE',
          },
        };

        if (query.uploadedByIds.length > 0) {
          where.uploadedById = {
            in: query.uploadedByIds,
          };
        }

        if (query.category) {
          where.category = query.category;
        }

        if (query.from || query.to) {
          where.timestampLocal = {};
          if (query.from) {
            where.timestampLocal.gte = query.from;
          }
          if (query.to) {
            where.timestampLocal.lte = query.to;
          }
        }

        const [photos, totalItems, authorRows, siteRows] = await Promise.all([
          prisma.photo.findMany({
            where,
            orderBy: [{ timestampLocal: query.sort }, { id: query.sort }],
            skip: (query.page - 1) * 20,
            take: 20,
            select: {
              id: true,
              siteId: true,
              uploadedById: true,
              category: true,
              description: true,
              filename: true,
              fileSize: true,
              format: true,
              latitude: true,
              longitude: true,
              timestampLocal: true,
              takenAt: true,
              isDeleted: true,
              deletedAt: true,
              createdAt: true,
              uploadedBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: true,
                },
              },
              site: {
                select: {
                  name: true,
                },
              },
            },
          }),
          prisma.photo.count({ where }),
          prisma.photo.findMany({
            where,
            distinct: ['uploadedById'],
            orderBy: [{ uploadedBy: { firstName: 'asc' } }, { uploadedBy: { lastName: 'asc' } }],
            select: {
              uploadedBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: true,
                },
              },
            },
          }),
          prisma.site.findMany({
            where: {
              projectId: firstProject.id,
              status: 'ACTIVE',
            },
            select: {
              id: true,
              name: true,
            },
            orderBy: {
              name: 'asc',
            },
          }),
        ]);

        photosResponse = {
          items: photos.map((photo) => ({
            id: photo.id,
            siteId: photo.siteId,
            siteName: photo.site.name,
            uploadedById: photo.uploadedById,
            category: photo.category,
            description: photo.description,
            filename: photo.filename,
            fileSize: photo.fileSize,
            format: photo.format,
            latitude: photo.latitude?.toNumber() ?? null,
            longitude: photo.longitude?.toNumber() ?? null,
            timestampLocal: photo.timestampLocal.toISOString(),
            takenAt: photo.takenAt.toISOString(),
            isDeleted: photo.isDeleted,
            deletedAt: photo.deletedAt?.toISOString() ?? null,
            createdAt: photo.createdAt.toISOString(),
            author: {
              id: photo.uploadedBy.id,
              firstName: photo.uploadedBy.firstName,
              lastName: photo.uploadedBy.lastName,
              role: photo.uploadedBy.role,
            },
            url: createInternalPhotoUrl(photo.id),
          })),
          page: query.page,
          pageSize: 20,
          totalItems,
          totalPages: Math.max(1, Math.ceil(totalItems / 20)),
          authors: authorRows.map((row) => row.uploadedBy),
          sites: siteRows,
        };
      }
    }

    if (!photosResponse) {
      return jsonPhotoError('INTERNAL_ERROR', 500, 'Erreur interne du serveur.');
    }

    return Response.json(photosResponse);
  } catch (error) {
    console.error('Mobile photo gallery error:', error);
    return jsonPhotoError('INTERNAL_ERROR', 500, 'Erreur lors du chargement de la galerie.');
  }
});
