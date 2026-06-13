'use client';

import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type MobileInstallPromptProps = Readonly<{
  compact?: boolean;
}>;

const dismissedStorageKey = 'chantierpro-install-prompt-dismissed';

export function MobileInstallPrompt({ compact = false }: MobileInstallPromptProps) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setIsInstalled(isRunningStandalone());
    setIsDismissed(window.localStorage.getItem(dismissedStorageKey) === 'true');

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setIsDismissed(false);
    }

    function handleAppInstalled() {
      setIsInstalled(true);
      setInstallEvent(null);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isInstalled || (isDismissed && !installEvent)) {
    return null;
  }

  async function handleInstall() {
    if (!installEvent) {
      setShowHelp((current) => !current);
      return;
    }

    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
    }
  }

  function handleDismiss() {
    window.localStorage.setItem(dismissedStorageKey, 'true');
    setIsDismissed(true);
  }

  return (
    <section className={compact ? 'rounded-2xl border border-orange-200 bg-orange-50 p-4 text-orange-950' : 'rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-950 shadow-panel'}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-600 text-white">
          <InstallIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-700">Application mobile</p>
          <h2 className="mt-1 text-base font-black text-slate-950">Installer ChantierPro</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-orange-900">
            Ajoutez l&apos;application sur l&apos;ecran d&apos;accueil pour l&apos;ouvrir plus vite.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="min-h-11 rounded-xl bg-orange-600 px-4 text-sm font-black text-white transition active:scale-[0.98] hover:bg-orange-700"
          onClick={() => {
            void handleInstall();
          }}
          type="button"
        >
          {installEvent ? "Installer l'application" : 'Comment installer ?'}
        </button>
        <button
          className="min-h-11 rounded-xl px-4 text-sm font-black text-orange-800 transition hover:bg-orange-100"
          onClick={handleDismiss}
          type="button"
        >
          Plus tard
        </button>
      </div>

      {showHelp || !installEvent ? (
        <ol className="mt-4 space-y-2 rounded-2xl bg-white/70 p-4 text-sm font-semibold leading-6 text-slate-700">
          <li>1. Ouvrez ChantierPro dans Chrome.</li>
          <li>2. Appuyez sur les trois points en haut a droite.</li>
          <li>3. Choisissez Installer l&apos;application ou Ajouter a l&apos;ecran d&apos;accueil.</li>
        </ol>
      ) : null}
    </section>
  );
}

function isRunningStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function InstallIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M12 4v10" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      <path d="m8 10 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M5 17v2h14v-2" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
