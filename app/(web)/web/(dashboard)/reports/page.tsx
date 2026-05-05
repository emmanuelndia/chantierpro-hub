import { WebStubPage } from '@/components/web-stub-page';

export default function WebReportsPage() {
  return (
    <WebStubPage
      ctaHref="/web/dashboard"
      ctaLabel="Retour au tableau de bord"
      description="Espace de consultation des rapports terrain pour les roles autorises. La route est maintenant navigable pour les coordinateurs, superviseurs generaux, chefs de projet, Direction et admins."
      eyebrow="Rapports terrain"
      title="Rapports terrain"
    />
  );
}
