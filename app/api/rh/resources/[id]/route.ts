import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessRh, jsonRhError } from '@/lib/rh';

type UpdateRhResourceBody = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  matricule?: unknown;
  contact?: unknown;
};

export const PATCH = withAuth<{ id: string }>(async ({ req, user, params }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse a la modification RH.');
  }

  const resourceId = params.id;
  if (!resourceId) {
    return jsonRhError('BAD_REQUEST', 400, 'Ressource introuvable.');
  }

  const body = (await req.json().catch(() => null)) as UpdateRhResourceBody | null;
  if (!body || typeof body !== 'object') {
    return jsonRhError('BAD_REQUEST', 400, 'Payload invalide.');
  }

  const firstName = parseRequiredText(body.firstName);
  const lastName = parseRequiredText(body.lastName);
  const email = parseOptionalText(body.email);
  const matricule = parseOptionalText(body.matricule);
  const contact = parseOptionalText(body.contact) ?? '';

  if (!firstName || !lastName) {
    return jsonRhError('BAD_REQUEST', 400, 'Le prenom et le nom sont obligatoires.');
  }

  try {
    const updated = await prisma.user.update({
      where: {
        id: resourceId,
      },
      data: {
        firstName,
        lastName,
        email,
        matricule,
        contact,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        matricule: true,
        contact: true,
        role: true,
      },
    });

    return Response.json({ resource: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return jsonRhError('NOT_FOUND', 404, 'Ressource introuvable.');
      }

      if (error.code === 'P2002') {
        return jsonRhError('BAD_REQUEST', 409, 'Email ou matricule deja utilise.');
      }
    }

    throw error;
  }
});

function parseRequiredText(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseOptionalText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}
