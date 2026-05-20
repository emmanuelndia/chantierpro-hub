import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import type { PlanningAssignmentStatus, PlanningWorkLocationType, Prisma, PrismaClient, Role } from '@prisma/client';
import { operationalPlanningSiteWhere } from '@/lib/mobile-planning';

type AuthLikeUser = {
  id: string;
  role: Role;
};

export type PlanningExportFormat = 'xlsx' | 'pdf';

export type PlanningExportQuery = {
  date: string;
  projectId: string | null;
  siteId: string | null;
  resourceId: string | null;
  format: PlanningExportFormat;
};

type PlanningExportRow = {
  date: string;
  project: string;
  site: string;
  address: string;
  resource: string;
  role: string;
  type: string;
  action: string;
  progress: string;
  status: string;
  createdBy: string;
};

const statusLabels: Record<PlanningAssignmentStatus, string> = {
  ASSIGNED: 'Non démarré',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

const workLocationLabels: Record<PlanningWorkLocationType, string> = {
  ON_SITE: 'Terrain',
  OFFICE: 'Bureau',
};

const roleLabels: Partial<Record<Role, string>> = {
  ADMIN: 'Administrateur',
  DIRECTION: 'Direction',
  PROJECT_MANAGER: 'Chef de projet',
  GENERAL_SUPERVISOR: 'Superviseur général',
  SUPERVISOR: 'Superviseur terrain',
  COORDINATOR: 'Coordinatrice',
};

export function parsePlanningExportQuery(searchParams: URLSearchParams): PlanningExportQuery | null {
  const date = searchParams.get('date')?.trim();
  if (!date || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    return null;
  }

  const format = parsePlanningExportFormat(searchParams.get('format'));
  if (!format) {
    return null;
  }

  return {
    date,
    projectId: normalizeFilter(searchParams.get('projectId')),
    siteId: normalizeFilter(searchParams.get('siteId')),
    resourceId: normalizeFilter(searchParams.get('resourceId')),
    format,
  };
}

export async function buildPlanningExport(prisma: PrismaClient, user: AuthLikeUser, query: PlanningExportQuery) {
  const rows = await getPlanningExportRows(prisma, user, query);

  if (query.format === 'pdf') {
    return buildPlanningExportPdf(rows, query.date);
  }

  return buildPlanningExportXlsx(rows, query.date);
}

async function getPlanningExportRows(
  prisma: PrismaClient,
  user: AuthLikeUser,
  query: PlanningExportQuery,
): Promise<PlanningExportRow[]> {
  const date = new Date(`${query.date}T00:00:00.000Z`);
  const siteFilters: Prisma.SiteWhereInput[] = [operationalPlanningSiteWhere(user, date)];

  if (query.projectId) {
    siteFilters.push({ projectId: query.projectId });
  }

  if (query.siteId) {
    siteFilters.push({ id: query.siteId });
  }

  const assignments = await prisma.planningAssignment.findMany({
    where: {
      date,
      deletedAt: null,
      ...(query.resourceId ? { supervisorId: query.resourceId } : {}),
      site: {
        AND: siteFilters,
      },
    },
    orderBy: [
      { site: { project: { name: 'asc' } } },
      { site: { name: 'asc' } },
      { supervisor: { firstName: 'asc' } },
      { supervisor: { lastName: 'asc' } },
      { id: 'asc' },
    ],
    select: {
      date: true,
      action: true,
      targetProgress: true,
      status: true,
      workLocationType: true,
      supervisor: {
        select: {
          firstName: true,
          lastName: true,
          role: true,
        },
      },
      site: {
        select: {
          name: true,
          address: true,
          project: {
            select: {
              name: true,
            },
          },
        },
      },
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return assignments.map((assignment) => ({
    date: formatFrenchDate(assignment.date),
    project: assignment.site.project.name,
    site: assignment.site.name,
    address: assignment.site.address,
    resource: `${assignment.supervisor.firstName} ${assignment.supervisor.lastName}`,
    role: roleLabels[assignment.supervisor.role] ?? assignment.supervisor.role,
    type: workLocationLabels[assignment.workLocationType],
    action: assignment.action,
    progress: assignment.targetProgress === null ? '' : String(assignment.targetProgress),
    status: statusLabels[assignment.status],
    createdBy: `${assignment.createdBy.firstName} ${assignment.createdBy.lastName}`,
  }));
}

function buildPlanningExportXlsx(rows: PlanningExportRow[], date: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ChantierPro';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Récap planning');
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Nom de la ressource', key: 'resource', width: 28 },
    { header: 'Poste', key: 'role', width: 24 },
    { header: 'Nom du projet', key: 'project', width: 28 },
    { header: 'Nom du site / adresse géographique', key: 'siteAddress', width: 36 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Action du jour', key: 'action', width: 50 },
    { header: 'Progression en %', key: 'progress', width: 16 },
    { header: 'Statut', key: 'status', width: 18 },
    { header: 'Créé par', key: 'createdBy', width: 26 },
  ];

  worksheet.mergeCells('A1:J1');
  worksheet.getCell('A1').value = 'PLANNING ACTIVITÉS JOURNALIÈRES';
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };
  worksheet.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFBDD7EE' },
  };

  worksheet.spliceRows(2, 0, worksheet.columns.map((column) => column.header));
  worksheet.getRow(2).font = { bold: true };
  worksheet.getRow(2).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  for (const row of rows) {
    worksheet.addRow({
      ...row,
      siteAddress: row.address ? `${row.site} - ${row.address}` : row.site,
    });
  }

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF1F2937' } },
        left: { style: 'thin', color: { argb: 'FF1F2937' } },
        right: { style: 'thin', color: { argb: 'FF1F2937' } },
        top: { style: 'thin', color: { argb: 'FF1F2937' } },
      };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  });

  worksheet.views = [{ state: 'frozen', ySplit: 2 }];
  worksheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: worksheet.columns.length },
  };

  return workbook.xlsx.writeBuffer().then((buffer) => ({
    buffer: Buffer.from(buffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `recap-planning-${date}.xlsx`,
  }));
}

function buildPlanningExportPdf(rows: PlanningExportRow[], date: string) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const tableWidth = pageWidth - margin * 2;
  const columns = [
    { label: 'DATE', key: 'date', width: 19 },
    { label: 'NOM DE LA RESSOURCE', key: 'resource', width: 46 },
    { label: 'POSTE', key: 'role', width: 36 },
    { label: 'NOM DU PROJET', key: 'project', width: 34 },
    { label: 'SITE / ADRESSE', key: 'siteAddress', width: 42 },
    { label: 'TYPE', key: 'type', width: 20 },
    { label: 'ACTION DU JOUR', key: 'action', width: 58 },
    { label: 'PROGRESSION', key: 'progress', width: 22 },
    { label: 'STATUT', key: 'status', width: 22 },
  ];
  const scale = tableWidth / columns.reduce((sum, column) => sum + column.width, 0);
  const scaledColumns = columns.map((column) => ({ ...column, width: column.width * scale }));
  let y = margin;

  const drawTitle = () => {
    pdf.setFillColor(189, 215, 238);
    pdf.rect(margin, y, tableWidth, 8, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('PLANNING ACTIVITÉS JOURNALIÈRES', pageWidth / 2, y + 5.5, { align: 'center' });
    y += 12;
  };

  const drawHeader = () => {
    let x = margin;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    for (const column of scaledColumns) {
      pdf.rect(x, y, column.width, 14);
      const lines = pdf.splitTextToSize(column.label, column.width - 2) as string[];
      pdf.text(lines, x + column.width / 2, y + 5, { align: 'center', baseline: 'top' });
      x += column.width;
    }
    y += 14;
  };

  drawTitle();
  drawHeader();

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);

  for (const row of rows) {
    const cells = {
      ...row,
      siteAddress: row.address ? `${row.site} - ${row.address}` : row.site,
      progress: row.progress ? `${row.progress}%` : '',
    };
    const lineGroups = scaledColumns.map((column) =>
      pdf.splitTextToSize(String(cells[column.key as keyof typeof cells] ?? ''), column.width - 2) as string[],
    );
    const rowHeight = Math.max(9, ...lineGroups.map((lines) => lines.length * 4 + 4));

    if (y + rowHeight > pageHeight - margin) {
      pdf.addPage();
      y = margin;
      drawTitle();
      drawHeader();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
    }

    let x = margin;
    scaledColumns.forEach((column, index) => {
      pdf.rect(x, y, column.width, rowHeight);
      pdf.text(lineGroups[index] ?? [''], x + 1.2, y + 4.2);
      x += column.width;
    });
    y += rowHeight;
  }

  if (rows.length === 0) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text('Aucune tâche dans le planning pour les filtres sélectionnés.', margin, y + 8);
  }

  return {
    buffer: Buffer.from(pdf.output('arraybuffer')),
    contentType: 'application/pdf',
    fileName: `recap-planning-${date}.pdf`,
  };
}

function parsePlanningExportFormat(value: string | null): PlanningExportFormat | null {
  if (!value) {
    return 'xlsx';
  }

  return value === 'xlsx' || value === 'pdf' ? value : null;
}

function normalizeFilter(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function formatFrenchDate(value: Date) {
  return value.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
