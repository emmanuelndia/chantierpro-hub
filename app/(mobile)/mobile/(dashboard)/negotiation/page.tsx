import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileNegotiationPage } from '@/components/mobile-negotiation-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const negotiationMobileRoles: readonly Role[] = [Role.NEGOTIATION_RESOURCE, Role.NEGOTIATION_MANAGER];

export default async function MobileNegotiationRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/negotiation');
  }

  if (!negotiationMobileRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileNegotiationPage />;
}
