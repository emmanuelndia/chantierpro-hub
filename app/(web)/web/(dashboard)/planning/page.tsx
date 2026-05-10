import { PlanningWebPage } from '@/components/planning-web-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebPlanningPage() {
  const session = await getRequiredWebSession();

  return (
    <PlanningWebPage
      viewer={{
        role: session.role,
      }}
    />
  );
}
