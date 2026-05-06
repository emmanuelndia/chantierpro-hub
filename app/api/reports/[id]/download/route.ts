import { jsPDF } from 'jspdf';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';
import { canCreateReports, canReadAllReports, getAccessibleReportById, jsonReportError } from '@/lib/reports';
import type { ReportDetail } from '@/types/reports';

export const GET = withAuth<{ id: string }>(async ({ params, user, req }) => {
  if (!canCreateReports(user.role) && !canReadAllReports(user.role)) {
    return jsonReportError('FORBIDDEN', 403, 'Téléchargement du rapport non autorisé.');
  }

  const basePayload = {
    reportId: params.id,
    user,
  };

  const report = await getAccessibleReportById(
    prisma,
    user.role === 'COORDINATOR'
      ? { ...basePayload, siteIds: await getOperationalSiteIds(prisma, user.id) }
      : basePayload,
  );

  if (!report) {
    return jsonReportError('NOT_FOUND', 404, 'Rapport introuvable.');
  }

  const format = new URL(req.url).searchParams.get('format') ?? 'pdf';
  return format === 'txt' ? generateTextReport(report) : generatePDFReport(report);
});

function generateTextReport(report: ReportDetail) {
  const submittedAt = new Date(report.submittedAt);
  const content = `
===================================
RAPPORT DE CHANTIER - ChantierPro
===================================
Superviseur : ${report.author.firstName} ${report.author.lastName}
Chantier : ${report.siteId}
Date : ${submittedAt.toLocaleDateString('fr-FR')}
Session : ${report.session.date} ${report.session.time}
---
${report.content}
---
Statut : ${getStatusLabel(report.validationStatus)}
===================================
  `.trim();

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="rapport_${report.id}.txt"`,
    },
  });
}

function generatePDFReport(report: ReportDetail) {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 20;
  let y = margin;
  const submittedAt = new Date(report.submittedAt);

  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('RAPPORT DE CHANTIER - ChantierPro', pageWidth / 2, y, { align: 'center' });
  y += 15;

  pdf.setFontSize(12);
  pdf.text(`Superviseur : ${report.author.firstName} ${report.author.lastName}`, margin, y);
  y += 8;
  pdf.text(`Chantier : ${report.siteId}`, margin, y);
  y += 8;
  pdf.text(`Date : ${submittedAt.toLocaleDateString('fr-FR')}`, margin, y);
  y += 8;
  pdf.text(`Session : ${report.session.date} ${report.session.time}`, margin, y);
  y += 15;

  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  const lines = pdf.splitTextToSize(report.content, pageWidth - 2 * margin) as string[];

  for (const line of lines) {
    if (y > 270) {
      pdf.addPage();
      y = margin;
    }
    pdf.text(line, margin, y);
    y += 6;
  }

  y += 10;
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Statut : ${getStatusLabel(report.validationStatus)}`, margin, y);

  const pdfBytes = pdf.output('arraybuffer');
  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapport_${report.id}.pdf"`,
      'Content-Length': pdfBytes.byteLength.toString(),
    },
  });
}

function getStatusLabel(status: ReportDetail['validationStatus']): string {
  switch (status) {
    case 'SUBMITTED':
      return 'Soumis';
    case 'VALIDATED_FOR_CLIENT':
      return 'Validé';
    default:
      return status;
  }
}
