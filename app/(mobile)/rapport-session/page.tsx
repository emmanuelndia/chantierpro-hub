import { redirect } from 'next/navigation';
import { MobileSessionReportPage } from '@/components/mobile-session-report-page';
import { MobilePlaceholderPage } from '@/components/mobile-placeholder-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';
import { FIELD_USER_ROLES } from '@/lib/field-roles';

export default async function MobileSessionReportPageWrapper() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/rapport-session');
  }

  if (FIELD_USER_ROLES.includes(session.role)) {
    return <MobileSessionReportPage user={session} />;
  }

  // Page placeholder pour les autres rôles
  return (
    <MobilePlaceholderPage
      badge="Rapport"
      title="Rapport de session"
      description="Soumission du rapport journalier de fin de session."
    />
  );
}
