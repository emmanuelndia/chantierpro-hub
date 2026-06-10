import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { NegotiationWebPage } from '@/components/negotiation-web-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

const negotiationWebRoles: readonly Role[] = [Role.NEGOTIATION_MANAGER, Role.DIRECTION, Role.ADMIN];

export default async function WebNegotiationPage() {
  const session = await getRequiredWebSession();

  if (!negotiationWebRoles.includes(session.role)) {
    redirect('/403');
  }

  return <NegotiationWebPage />;
}
