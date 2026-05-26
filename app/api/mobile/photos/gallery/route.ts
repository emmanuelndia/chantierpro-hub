import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getBusinessManagedResourceRoles, isBusinessManagerRole } from '@/lib/field-roles';
import { canUploadPhotos, createInternalPhotoUrl, jsonPhotoError, parsePhotoListQuery } from '@/lib/photos';
import type { PaginatedPhotosResponse } from '@/types/photos';
import { Prisma, ProjectStatus, SiteStatus } from '@prisma/client';

const mobileGalleryPhotoSelect = {
  id: true,
  siteId: true,
  uploadedById: true,
  planningAssignmentId: true,
  category: true,
  tags: true,
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
  planningAssignment: {
    select: {
      action: true,
      status: true,
    },
  },
} satisfies Prisma.PhotoSelect;

type MobileGalleryPhoto = Prisma.PhotoGetPayload<{ select: typeof mobileGalleryPhotoSelect }>;
type MobileGalleryQuery = ReturnType<typeof parsePhotoListQuery>;

function addPhotoFilters(where: Prisma.PhotoWhereInput, query: MobileGalleryQuery) {
  if (query.uploadedByIds.length > 0) {
    where.uploadedById = {
      in: query.uploadedByIds,
    };
  }

  if (query.category) {
    where.category = query.category;
  }

  if (query.tag) {
    where.tags = {
      has: query.tag,
    };
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
}

function serializeMobileGalleryPhoto(photo: MobileGalleryPhoto) {
  return {
    id: photo.id,
    siteId: photo.siteId,
    siteName: photo.site.name,
    uploadedById: photo.uploadedById,
    planningAssignmentId: photo.planningAssignmentId,
    assignmentAction: photo.planningAssignment?.action ?? null,
    assignmentStatus: photo.planningAssignment?.status ?? null,
    category: photo.category,
    tags: photo.tags,
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
  };
}

export const GET = withAuth(async ({ user, req }) => {
  if (!canUploadPhotos(user.role)) {
    return jsonPhotoError('FORBIDDEN', 403, "Accès refusé à la galerie photo mobile.");
  }

  const { searchParams } = new URL(req.url);
  const query = parsePhotoListQuery(searchParams);

  try {
    let photosResponse: PaginatedPhotosResponse | null = null;

    // Pour les rôles DIRECTION et ADMIN : tous les sites
    if (user.role === 'DIRECTION' || user.role === 'ADMIN') {
      // Récupérer toutes les photos de tous les sites actifs
      const where: Prisma.PhotoWhereInput = {
        isDeleted: false,
        site: {
          status: SiteStatus.ACTIVE,
        },
      };

      addPhotoFilters(where, query);

      const [photos, totalItems, authorRows, siteRows] = await Promise.all([
        prisma.photo.findMany({
          where,
          orderBy: [{ timestampLocal: query.sort }, { id: query.sort }],
          skip: (query.page - 1) * 20,
          take: 20,
          select: mobileGalleryPhotoSelect,
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
            status: SiteStatus.ACTIVE,
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
        items: photos.map(serializeMobileGalleryPhoto),
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
            status: ProjectStatus.IN_PROGRESS,
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
        const firstProject = projects[0]!;
        
        const where: Prisma.PhotoWhereInput = {
          isDeleted: false,
          site: {
            projectId: firstProject.id,
            status: SiteStatus.ACTIVE,
          },
        };

        addPhotoFilters(where, query);

        const [photos, totalItems, authorRows, siteRows] = await Promise.all([
          prisma.photo.findMany({
            where,
            orderBy: [{ timestampLocal: query.sort }, { id: query.sort }],
            skip: (query.page - 1) * 20,
            take: 20,
            select: mobileGalleryPhotoSelect,
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
              status: SiteStatus.ACTIVE,
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
          items: photos.map(serializeMobileGalleryPhoto),
          page: query.page,
          pageSize: 20,
          totalItems,
          totalPages: Math.max(1, Math.ceil(totalItems / 20)),
          authors: authorRows.map((row) => row.uploadedBy),
          sites: siteRows,
        };
      }
    }
    else if (isBusinessManagerRole(user.role)) {
      const where: Prisma.PhotoWhereInput = {
        isDeleted: false,
        site: {
          status: SiteStatus.ACTIVE,
          planningAssignments: {
            some: {
              deletedAt: null,
              supervisor: {
                role: { in: [...getBusinessManagedResourceRoles(user.role)] },
                isActive: true,
              },
            },
          },
        },
      };

      addPhotoFilters(where, query);

      const [photos, totalItems, authorRows, siteRows] = await Promise.all([
        prisma.photo.findMany({
          where,
          orderBy: [{ timestampLocal: query.sort }, { id: query.sort }],
          skip: (query.page - 1) * 20,
          take: 20,
          select: mobileGalleryPhotoSelect,
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
          where: where.site as Prisma.SiteWhereInput,
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
        items: photos.map(serializeMobileGalleryPhoto),
        page: query.page,
        pageSize: 20,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / 20)),
        authors: authorRows.map((row) => row.uploadedBy),
        sites: siteRows,
      };
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
