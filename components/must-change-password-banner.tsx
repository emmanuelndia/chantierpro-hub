'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { useState } from 'react';

type MustChangePasswordBannerProps = Readonly<{
  href: string;
  variant: 'web' | 'mobile';
}>;

export function MustChangePasswordBanner({ href, variant }: MustChangePasswordBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  const className =
    variant === 'mobile'
      ? 'mx-4 mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900'
      : 'mb-5 rounded-3xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900 shadow-sm';

  return (
    <section className={className}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-black">Votre mot de passe temporaire doit être changé.</p>
          <p className="mt-1 leading-6">
            Pour sécuriser votre compte, ouvrez votre profil et choisissez un nouveau mot de passe.
          </p>
          <Link className="mt-2 inline-flex font-black text-orange-700 underline-offset-4 hover:underline" href={href}>
            Changer le mot de passe
          </Link>
        </div>
        <button
          aria-label="Fermer le message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-orange-700"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
