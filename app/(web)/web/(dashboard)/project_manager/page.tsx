import { redirect } from 'next/navigation';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebProjectManagerAliasPage() {
  const session = await getRequiredWebSession();

  if (session.role === 'DIRECTION') {
    redirect('/web/projects');
  }

  redirect('/web/my-projects');
}
