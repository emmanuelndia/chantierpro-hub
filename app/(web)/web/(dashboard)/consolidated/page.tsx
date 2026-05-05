import { WebStubPage } from '@/components/web-stub-page';

const rows = [
  { id: '1', primary: 'Residence Horizon', secondary: '8 chantiers / 48 ressources', status: 'Pret', updatedAt: '2026-04-28' },
  { id: '2', primary: 'Tour Cocody', secondary: '3 alertes actives', status: 'Pret', updatedAt: '2026-04-28' },
  { id: '3', primary: 'Zone Portuaire', secondary: 'Heures mensuelles a controler', status: 'En attente', updatedAt: '2026-04-26' },
] as const;

export default function WebConsolidatedPage() {
  return (
    <WebStubPage
      description="Vue consolidee orientee Direction/Admin. Le shell est en place pour accueillir les KPI et les agregats projets sans refaire la navigation."
      eyebrow="Vue consolidee"
      tableRows={rows}
      title="Vue consolidee"
    />
  );
}
