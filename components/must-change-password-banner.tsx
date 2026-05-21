'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type MustChangePasswordBannerProps = Readonly<{
  href: string;
  show: boolean;
}>;

export function MustChangePasswordBanner({ href, show }: MustChangePasswordBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const bannerKey = useMemo(() => `must-change-password:${href}`, [href]);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(bannerKey) === 'hidden');
  }, [bannerKey]);

  if (!show || dismissed) {
    return null;
  }

  return (
    <div className="border-b border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950">
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-600 text-xs font-black text-white">
          !
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Votre mot de passe temporaire doit être changé.</p>
          <Link className="mt-1 inline-flex font-semibold text-orange-700 underline-offset-4 hover:underline" href={href}>
            Aller au profil
          </Link>
        </div>
        <button
          aria-label="Masquer le message"
          className="rounded-full p-1 text-orange-800 transition hover:bg-orange-100"
          onClick={() => {
            sessionStorage.setItem(bannerKey, 'hidden');
            setDismissed(true);
          }}
          type="button"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function CloseIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
