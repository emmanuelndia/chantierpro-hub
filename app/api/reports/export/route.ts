import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';
import { canCreateReports, canReadAllReports, jsonReportError } from '@/lib/reports';
import { jsPDF } from 'jspdf';

export const GET = withAuth(async ({ user, searchParams }) => {
  if (!canCreateReports(user.role) && !canReadAllReports(user.role)) {
    return jsonReportError('FORBIDDEN', 403, 'Export des rapports non autorisé.');
  }

  const date = searchParams.get('date');
  const format = searchParams.get('format') || 'pdf';

  if (!date) {
    return jsonReportError('BAD_REQUEST', 400, 'Le paramètre date est requis.');
  }

  const targetDate = new Date(date);
  if (isNaN(targetDate.getTime())) {
    return jsonReportError('BAD_REQUEST', 400, 'Format de date invalide.');
  }

  // Récupérer les rapports du jour pour le coordinateur
  const siteIds = user.role === 'COORDINATOR' 
    ? await getOperationalSiteIds(prisma, user.id)
    : undefined;

  const reports = await prisma.report.findMany({
    where: {
      submittedAt: {
        gte: new Date(targetDate.setHours(0, 0, 0, 0)),
        lt: new Date(targetDate.setHours(23, 59, 59, 999)),
      },
      ...(siteIds && { siteId: { in: siteIds } }),
    },
    include: {
      supervisor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      site: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
      clockInRecord: {
        select: {
          clockInDate: true,
          clockInTime: true,
          timestampLocal: true,
        },
      },
    },
    orderBy: [
      { site: { name: 'asc' } },
      { supervisor: { firstName: 'asc' } },
      { submittedAt: 'asc' },
    ],
  });

  if (reports.length === 0) {
    return jsonReportError('NOT_FOUND', 404, 'Aucun rapport trouvé pour cette date.');
  }

  if (format === 'txt') {
    return generateTextExport(reports, targetDate);
  } else {
    return generatePDFExport(reports, targetDate);
  }
});

function generateTextExport(reports: any[], date: Date) {
  const content = reports.map((report, index) => {
    const startTime = new Date(report.clockInRecord.timestampLocal).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const endTime = new Date(report.submittedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const duration = Math.round((new Date(report.submittedAt).getTime() - new Date(report.clockInRecord.timestampLocal).getTime()) / 60000);

    return `
===================================
RAPPORT ${index + 1}/${reports.length} — ChantierPro
===================================
Superviseur : ${report.supervisor.firstName} ${report.supervisor.lastName}
Site : ${report.site.name}
Date : ${new Date(report.submittedAt).toLocaleDateString('fr-FR')}
Session : ${startTime} → ${endTime} (${duration} min)
Progression : ${report.progressPercentage}%
---
${report.content}
---
Statut : ${getStatusLabel(report.validationStatus)}
===================================
    `.trim();
  }).join('\n\n');

  const header = `
===================================
EXPORT DES RAPPORTS DU JOUR — ChantierPro
===================================
Date : ${date.toLocaleDateString('fr-FR')}
Nombre de rapports : ${reports.length}
Généré le : ${new Date().toLocaleString('fr-FR')}
===================================
  `.trim();

  return new Response(header + '\n\n' + content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="rapports_${date.toISOString().split('T')[0]}.txt"`,
    },
  });
}

function generatePDFExport(reports: any[], date: Date) {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 20;
  let y = margin;

  // En-tête
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('EXPORT DES RAPPORTS DU JOUR', pageWidth / 2, y, { align: 'center' });
  y += 10;

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Date : ${date.toLocaleDateString('fr-FR')}`, pageWidth / 2, y, { align: 'center' });
  y += 8;
  pdf.text(`Nombre de rapports : ${reports.length}`, pageWidth / 2, y, { align: 'center' });
  y += 15;

  reports.forEach((report, index) => {
    // Vérifier s'il faut ajouter une nouvelle page
    if (y > 200) {
      pdf.addPage();
      y = margin;
    }

    // En-tête du rapport
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`RAPPORT ${index + 1}/${reports.length}`, margin, y);
    y += 10;

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Superviseur : ${report.supervisor.firstName} ${report.supervisor.lastName}`, margin, y);
    y += 6;

    pdf.text(`Site : ${report.site.name}`, margin, y);
    y += 6;

    const startTime = new Date(report.clockInRecord.timestampLocal).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const endTime = new Date(report.submittedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const duration = Math.round((new Date(report.submittedAt).getTime() - new Date(report.clockInRecord.timestampLocal).getTime()) / 60000);
    pdf.text(`Session : ${startTime} → ${endTime} (${duration} min)`, margin, y);
    y += 6;

    pdf.text(`Progression : ${report.progressPercentage}%`, margin, y);
    y += 10;

    // Séparateur
    pdf.text('---', margin, y);
    y += 10;

    // Contenu du rapport
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    const lines = pdf.splitTextToSize(report.content, pageWidth - 2 * margin);
    
    for (const line of lines) {
      if (y > 270) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += 5;
    }

    y += 8;

    // Séparateur et statut
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('---', margin, y);
    y += 8;
    pdf.text(`Statut : ${getStatusLabel(report.validationStatus)}`, margin, y);
    y += 15;

    // Séparateur entre rapports
    if (index < reports.length - 1) {
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.text('===================================', margin, y);
      y += 15;
    }
  });

  const pdfBytes = pdf.output('arraybuffer');
  
  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapports_${date.toISOString().split('T')[0]}.pdf"`,
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
