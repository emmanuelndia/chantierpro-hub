import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { buildDirectionAttendanceReportExport, canAccessDirectionAttendanceReport, jsonRhError } from '@/lib/rh';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessDirectionAttendanceReport(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse au rapport Direction.');
  }

  const searchParams = new URL(req.url).searchParams;
  const format = searchParams.get('format');
  const dateParam = searchParams.get('date');
  const date = dateParam ? new Date(`${dateParam}T00:00:00.000Z`) : new Date();

  if (format !== 'xlsx' && format !== 'pdf') {
    return jsonRhError('BAD_REQUEST', 400, 'Format export invalide.');
  }

  if (Number.isNaN(date.getTime())) {
    return jsonRhError('BAD_REQUEST', 400, 'Date invalide.');
  }

  try {
    const artifact = await buildDirectionAttendanceReportExport(prisma, date, format);
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