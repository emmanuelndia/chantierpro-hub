import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { buildDirectionAttendanceReportExport, canAccessDirectionAttendanceReport, jsonRhError, type DirectionAttendanceExportScope } from '@/lib/rh';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessDirectionAttendanceReport(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse au rapport Direction.');
  }

  const searchParams = new URL(req.url).searchParams;
  const format = searchParams.get('format');
  const dateParam = searchParams.get('date');
  const scope = parseDirectionAttendanceExportScope(searchParams.get('scope'));
  const roles = parseDirectionAttendanceRoles(searchParams.get('roles'));
  const date = dateParam ? new Date(`${dateParam}T00:00:00.000Z`) : new Date();

  if (format !== 'xlsx' && format !== 'pdf') {
    return jsonRhError('BAD_REQUEST', 400, 'Format export invalide.');
  }

  if (Number.isNaN(date.getTime())) {
    return jsonRhError('BAD_REQUEST', 400, 'Date invalide.');
  }

  if (!scope) {
    return jsonRhError('BAD_REQUEST', 400, 'Contenu export invalide.');
  }

  try {
    const artifact = await buildDirectionAttendanceReportExport(prisma, date, format, scope, roles);
    return new Response(Uint8Array.from(artifact.buffer), {
      status: 200,
      headers: {
        'content-type': artifact.contentType,
        'content-disposition': `attachment; filename="${artifact.fileName}"`,
      },
    });
  } catch {
    return jsonRhError('EXPORT_FAILED', 500, "La generation du rapport Direction a echoue.");
  }
});
function parseDirectionAttendanceExportScope(value: string | null): DirectionAttendanceExportScope | null {
  if (!value) return 'all';
  const allowedScopes: DirectionAttendanceExportScope[] = ['all', 'clocked-today', 'not-clocked-today', 'never-clocked', 'departure-only'];
  return allowedScopes.includes(value as DirectionAttendanceExportScope) ? (value as DirectionAttendanceExportScope) : null;
}

function parseDirectionAttendanceRoles(value: string | null): Role[] {
  if (!value) return [];
  const allowedRoles = new Set(Object.values(Role));
  return value
    .split(',')
    .map((role) => role.trim())
    .filter((role): role is Role => allowedRoles.has(role as Role));
}
