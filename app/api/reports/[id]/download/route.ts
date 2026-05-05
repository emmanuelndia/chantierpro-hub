import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';
import { canCreateReports, canReadAllReports, getAccessibleReportById, jsonReportError } from '@/lib/reports';
import { jsPDF } from 'jspdf';

export const GET = withAuth<{ id: string }>(async ({ params, user, searchParams }) => {
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

  const format = searchParams.get('format') || 'pdf';
  
  if (format === 'txt') {
    return generateTextReport(report);
  } else {
    return generatePDFReport(report);
  }
});

function generateTextReport(report: any) {
  const content = `
===================================
RAPPORT DE CHANTIER — ChantierPro
===================================
Superviseur : ${report.supervisorFirstName} ${report.supervisorName}
Site : ${report.siteName}
Date : ${new Date(report.submittedAt).toLocaleDateString('fr-FR')}
Session : ${new Date(report.sessionStartedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} → ${new Date(report.sessionEndedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (${Math.round(report.sessionDuration / 60)} min)
Progression : ${report.progressPercentage}%
---
${report.content}
---
Statut : ${getStatusLabel(report.status)}
===================================
  `.trim();

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="rapport_${report.id}.txt"`,
    },
  });
}

function generatePDFReport(report: any) {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 20;
  let y = margin;

  // En-tête
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('RAPPORT DE CHANTIER — ChantierPro', pageWidth / 2, y, { align: 'center' });
  y += 15;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text('='.repeat(50), pageWidth / 2, y, { align: 'center' });
  y += 10;

  // Informations
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Superviseur : ${report.supervisorFirstName} ${report.supervisorName}`, margin, y);
  y += 8;

  pdf.text(`Site : ${report.siteName}`, margin, y);
  y += 8;

  pdf.text(`Date : ${new Date(report.submittedAt).toLocaleDateString('fr-FR')}`, margin, y);
  y += 8;

  const startTime = new Date(report.sessionStartedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const endTime = new Date(report.sessionEndedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const duration = Math.round(report.sessionDuration / 60);
  pdf.text(`Session : ${startTime} → ${endTime} (${duration} min)`, margin, y);
  y += 8;

  pdf.text(`Progression : ${report.progressPercentage}%`, margin, y);
  y += 15;

  // Séparateur
  pdf.setFontSize(10);
  pdf.text('---', margin, y);
  y += 10;

  // Contenu du rapport
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  const lines = pdf.splitTextToSize(report.content, pageWidth - 2 * margin);
  
  for (const line of lines) {
    if (y > 270) {
      pdf.addPage();
      y = margin;
    }
    pdf.text(line, margin, y);
    y += 6;
  }

  y += 10;

  // Séparateur
  pdf.setFontSize(10);
  pdf.text('---', margin, y);
  y += 10;

  // Statut
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Statut : ${getStatusLabel(report.status)}`, margin, y);
  y += 10;

  // Pied de page
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text('='.repeat(50), pageWidth / 2, y, { align: 'center' });

  const pdfBytes = pdf.output('arraybuffer');
  
  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapport_${report.id}.pdf"`,
      'Content-Length': pdfBytes.byteLength.toString(),
    },
  });
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'EN ATTENTE';
    case 'SUBMITTED':
      return 'REÇU';
    case 'REVIEWED':
      return 'EXAMINÉ';
    case 'VALIDATED':
      return 'VALIDÉ';
    case 'SENT':
      return 'ENVOYÉ';
    default:
      return status;
  }
}
