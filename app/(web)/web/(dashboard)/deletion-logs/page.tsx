import { WebStubPage } from '@/components/web-stub-page';

const rows = [
  { id: '1', primary: 'PHOTO_001', secondary: 'Suppression par Direction', status: 'Pret', updatedAt: '2026-04-28 09:20' },
  { id: '2', primary: 'PHOTO_002', secondary: 'Motif documente', status: 'Pret', updatedAt: '2026-04-27 17:05' },
  { id: '3', primary: 'PHOTO_003', secondary: 'Controle audit en attente', status: 'En attente', updatedAt: '2026-04-26 11:44' },
] as const;

export default function WebDeletionLogsPage() {
  return (
    <WebStubPage
      description="Destination web dediee aux logs de suppression photo. Le tableau de demonstration sera remplace facilement par les donnees de /api/admin/logs."
      eyebrow="Logs de suppression"
      tableRows={rows}
      title="Logs de suppression"
    />
  );
}
