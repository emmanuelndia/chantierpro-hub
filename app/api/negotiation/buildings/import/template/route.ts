import ExcelJS from 'exceljs';
import { withAuth } from '@/lib/auth/with-auth';
import { canManageNegotiation } from '@/lib/negotiation';

const HEADERS = [
  'Région',
  'Ville',
  'Commune/Quartier',
  'Nom de l’immeuble',
  'Adresse',
  'Longitude',
  'Latitude',
  'Nom du propriétaire',
  'Téléphone 1',
  'Téléphone 2',
  'Email',
  'Type de propriété (Résidentiel / Commercial / Mixte)',
  'Fournisseur internet actuel',
  'Offre promotionnelle de 50Mbps (3 ou 6 mois)',
  'Statut accord (À contacter / En cours / Signé)',
  'Date de signature par le proprietaire',
  'Faisabilité technique (Oui/Non)',
  'Statut installation (Non démarré/En cours/Terminé)',
  'Statut activation (Non/Partiel/Complet) Internet',
  'Commentaires',
];

export const GET = withAuth(async ({ user }) => {
  if (!canManageNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Telechargement du modele refuse.' }, { status: 403 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ChantierPro';
  const worksheet = workbook.addWorksheet('Suivi Propriétaires Immeubles');
  worksheet.addRow(HEADERS);
  worksheet.addRow([
    'ABIDJAN',
    'ABIDJAN',
    'Yopougon',
    'Residence Exemple',
    'Rue exemple',
    -4.0652,
    5.3364,
    'M. Konan',
    '0700000000',
    '',
    'contact@example.com',
    'Résidentiel',
    '',
    '',
    'En cours',
    '',
    'Oui',
    'Non démarré',
    'Non',
    'Premier passage à effectuer',
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
