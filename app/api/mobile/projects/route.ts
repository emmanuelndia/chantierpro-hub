import { Prisma, ProjectStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileProjects, getMobileProjects } from '@/lib/mobile-projects';
import {
  jsonProjectError,
  parseCreateProjectInput,
  parseJsonBody,
  projectPublicSelect,
  serializeProject,
  validateDateRange,
  validateProjectManager,
} from '@/lib/projects';
import type { MobileProjectStatusFilter } from '@/types/mobile-projects';

const statusValues = new Set<string>(['ALL', ...Object.values(ProjectStatus)]);

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessMobileProjects(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const rawStatus = searchParams.get('status');
  const status = rawStatus && statusValues.has(rawStatus)
    ? (rawStatus as MobileProjectStatusFilter)
    : null;

  return Response.json(
    await getMobileProjects(prisma, user, {
      q: searchParams.get('q'),
      status,
    }),
  );
});

export const POST = withAuth(async ({ req, user }) => {
  if (!canAccessMobileProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé à la création de projet.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseCreateProjectInput(body);

  if (!input) {
    return jsonProjectError('BAD_REQUEST', 400, 'Le payload projet est invalide.');
  }

  if (!validateDateRange(input.startDate, input.endDate)) {
    return jsonProjectError(
      'INVALID_DATE_RANGE',
      400,
      'La date de fin doit être strictement supérieure à la date de début.',
    );
  }

  const projectManagerIsValid = await validateProjectManager(prisma, input.projectManagerId, user);

  if (!projectManagerIsValid) {
    return jsonProjectError(
      'INVALID_PROJECT_MANAGER',
      400,
      'Le chef de projet sélectionné est invalide pour cette opération.',
    );
  }

  try {
    const project = await prisma.project.create({
      data: {
        name: input.name,
        description: input.description,
        address: input.address,
        city: input.city,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        projectManagerId: input.projectManagerId,
        status: input.status ?? ProjectStatus.IN_PROGRESS,
        createdById: user.id,
      },
      select: projectPublicSelect,
    });

    return Response.json({ project: serializeProject(project) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return jsonProjectError('INVALID_PROJECT_MANAGER', 400, 'Chef de projet invalide.');
    }

    throw error;
  }
});
