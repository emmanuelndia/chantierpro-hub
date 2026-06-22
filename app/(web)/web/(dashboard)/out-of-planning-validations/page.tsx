import { OutOfPlanningValidationsPage } from '@/components/out-of-planning-validations-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebOutOfPlanningValidationsPage() {
  const session = await getRequiredWebSession();

  return <OutOfPlanningValidationsPage viewer={{ role: session.role }} />;
}