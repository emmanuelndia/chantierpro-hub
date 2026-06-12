import ExcelJS from 'exceljs';
import { withAuth } from '@/lib/auth/with-auth';
import { canManageNegotiation } from '@/lib/negotiation';

const HEADERS = [
  'CLUSTER',
  'VILLE',
  'COMMUNE',
  'PLAQUE',
  'HABITATION',
  'NOM IMMEUBLE',
  'INFORMATIONS INTERLOCUTEURS',
  'NIVEAU DE ELS',
  'EL',
  'EL REEL',
  'LONGITUDE',
  'LATITUDE',
  'CALQUE',
  'COULEUR',
  'PRESENCE OPERATEUR',
  'STATUT NEGOCIATION',
  'REMARQUE',
];

export const GET = withAuth(async ({ user }) => {
  if (!canManageNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Telechargement du modele refuse.' }, { status: 403 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ChantierPro';
  const worksheet = workbook.addWorksheet('HUB');
  worksheet.addRow(HEADERS);
  worksheet.addRow([
    'Cluster A',
    'Yopougon',
    'Selmer',
    'P-001',
    'Immeuble',
    'Residence Exemple',
    'M. Konan - 0700000000',
    'R+2',
    12,
    0,
    -4.0652,
    5.3364,
    '',
    '',
    'Non',
    'EN_COURS',
    'Premier passage a effectuer',
  ]);

  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column) => {
    column.width = 24;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="modele-import-scopes-negociation.xlsx"',
    },
  });
});
