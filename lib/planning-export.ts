import ExcelJS from 'exceljs';
import type { PlanningAssignmentStatus, PlanningWorkLocationType, Prisma, PrismaClient, Role } from '@prisma/client';
import { operationalPlanningSiteWhere } from '@/lib/mobile-planning';

type AuthLikeUser = {
  id: string;
  role: Role;
};

export type PlanningExportQuery = {
  date: string;
  projectId: string | null;
  siteId: string | null;
  resourceId: string | null;
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

export function parsePlanningExportQuery(searchParams: URLSearchParams): PlanningExportQuery | null {
  const date = searchParams.get('date')?.trim();
  if (!date || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    return null;
  }

  return {
    date,
    projectId: normalizeFilter(searchParams.get('projectId')),
    siteId: normalizeFilter(searchParams.get('siteId')),
    resourceId: normalizeFilter(searchParams.get('resourceId')),
  };
}

export async function buildPlanningExportXlsx(prisma: PrismaClient, user: AuthLikeUser, query: PlanningExportQuery) {
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

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ChantierPro';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Récap planning');
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Projet', key: 'project', width: 28 },
    { header: 'Chantier', key: 'site', width: 28 },
    { header: 'Adresse / repère', key: 'address', width: 36 },
    { header: 'Ressource', key: 'resource', width: 26 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Tâche', key: 'action', width: 46 },
    { header: 'Progression', key: 'progress', width: 14 },
    { header: 'Statut', key: 'status', width: 16 },
    { header: 'Créé par', key: 'createdBy', width: 26 },
  ];

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEFF6FF' },
  };

  for (const assignment of assignments) {
    worksheet.addRow({
      date: assignment.date.toISOString().slice(0, 10),
      project: assignment.site.project.name,
      site: assignment.site.name,
      address: assignment.site.address,
      resource: `${assignment.supervisor.firstName} ${assignment.supervisor.lastName}`,
      type: workLocationLabels[assignment.workLocationType],
      action: assignment.action,
      progress: assignment.targetProgress === null ? '' : `${assignment.targetProgress}%`,
      status: statusLabels[assignment.status],
      createdBy: `${assignment.createdBy.firstName} ${assignment.createdBy.lastName}`,
    });
  }

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    fileName: `recap-planning-${query.date}.xlsx`,
  };
}

function normalizeFilter(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}
