import Link from 'next/link';
import type { ReactNode } from 'react';

type MobileFloatingCreateLinkProps = Readonly<{
  href: string;
  label: string;
  icon?: ReactNode;
}>;

export function MobileFloatingCreateLink({ href, label, icon = <PlusIcon /> }: MobileFloatingCreateLinkProps) {
  return (
    <Link
      className="fixed right-4 z-40 flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-white shadow-xl shadow-slate-900/20 transition active:scale-[0.98]"
      href={href}
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)' }}
    >
      {icon}
      {label}
    </Link>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
