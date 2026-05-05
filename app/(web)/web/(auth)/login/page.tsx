'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import type { AuthErrorCode, LoginResponse } from '@/types/auth';

type LoginErrorPayload = {
  code?: AuthErrorCode;
  retryAfterSeconds?: number;
};

const emailPattern =
  /^(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\u0001-\u0008\u000B\u000C\u000E-\u001F\u0021\u0023-\u005B\u005D-\u007F]|\\[\u0001-\u0009\u000B\u000C\u000E-\u007F])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|(?:\d{1,3}\.){3}\d{1,3})$/;

function normalizeNextPath(next: string | null) {
  if (!next?.startsWith('/web')) {
    return '/web/dashboard';
  }

  return next;
}

function getInlineErrorMessage(code?: AuthErrorCode, retryAfterSeconds?: number) {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'Identifiants incorrects.';
    case 'ACCOUNT_DISABLED':
      return 'Votre compte a ete desactive.';
    case 'TOO_MANY_ATTEMPTS':
      return `Trop de tentatives. Reessayez dans ${retryAfterSeconds ?? 0} secondes.`;
    default:
      return 'Une erreur est survenue. Merci de reessayer.';
  }
}

export default function WebLoginPage() {
  return (
    <Suspense fallback={<LoginSessionLoadingState />}>
      <WebLoginContent />
    </Suspense>
  );
}

function WebLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken, isAuthenticated, setAccessToken } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCheckingExistingSession, setIsCheckingExistingSession] = useState(true);
  const hydratedRef = useRef(false);

  const nextPath = useMemo(
    () => normalizeNextPath(searchParams.get('next')),
    [searchParams],
  );
  const emailIsValid = emailPattern.test(email.trim());
  const canSubmit = email.trim().length > 0 && password.length > 0 && !isLoading;

  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }

    hydratedRef.current = true;

    if (isAuthenticated && accessToken) {
      router.replace(nextPath);
      return;
    }

    void (async () => {
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });

        if (!response.ok) {
          setIsCheckingExistingSession(false);
          return;
        }

        const payload = (await response.json()) as {
          accessToken: string;
        };

        setAccessToken(payload.accessToken);
        router.replace(nextPath);
      } catch {
        setIsCheckingExistingSession(false);
      }
    })();
  }, [accessToken, isAuthenticated, nextPath, router, setAccessToken]);

  async function handleLogin() {
    setEmailTouched(true);
    setErrorMessage(null);

    if (!emailIsValid) {
      setErrorMessage('Format d email invalide.');
      return;
    }

    if (!password) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as LoginErrorPayload;
        setErrorMessage(getInlineErrorMessage(payload.code, payload.retryAfterSeconds));
        return;
      }

      const payload = (await response.json()) as LoginResponse;
      setAccessToken(payload.accessToken);
      router.replace(nextPath);
    } catch {
      setErrorMessage('Connexion impossible pour le moment. Merci de reessayer.');
    } finally {
      setIsLoading(false);
    }
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    if (errorMessage) {
      setErrorMessage(null);
    }
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    if (errorMessage) {
      setErrorMessage(null);
    }
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (canSubmit) {
        void handleLogin();
      }
    }
  }

  if (isCheckingExistingSession) {
    return <LoginSessionLoadingState />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          CHANTIER<span className="text-orange-600">PRO</span>
        </h1>
        <p className="mt-2 text-sm text-slate-500 sm:text-base">
          Gestion de presence et documentation terrain
        </p>
      </div>

      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
        <h2 className="text-xl font-semibold text-slate-800">Connexion</h2>

        <div className="mt-6 space-y-5">
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700" htmlFor="email">
              Adresse Email
            </label>
            <input
              autoFocus
              className={`w-full rounded-lg border bg-slate-50 px-4 py-2.5 text-slate-900 outline-none transition-all ${
                emailTouched && email.trim().length > 0 && !emailIsValid
                  ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-200'
                  : 'border-slate-300 focus:border-orange-500 focus:ring-2 focus:ring-orange-500'
              }`}
              id="email"
              inputMode="email"
              onBlur={() => setEmailTouched(true)}
              onChange={(event) => handleEmailChange(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="jean.dupont@entreprise.fr"
              type="email"
              value={email}
            />
            {emailTouched && email.trim().length > 0 && !emailIsValid ? (
              <p className="mt-2 text-sm text-red-600">Format d email invalide.</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700" htmlFor="password">
              Mot de passe
            </label>
            <div className="relative">
              <input
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 pr-12 text-slate-900 outline-none transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-500"
                id="password"
                onChange={(event) => handlePasswordChange(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="••••••••"
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:text-slate-600"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {errorMessage ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircleIcon className="mt-0.5 h-[18px] w-[18px] shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-3 font-bold text-white shadow-md transition-all active:scale-[0.98] hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={!canSubmit}
            onClick={() => {
              void handleLogin();
            }}
            type="button"
          >
            {isLoading ? (
              <>
                <SpinnerIcon className="h-5 w-5 animate-spin" />
                Connexion en cours...
              </>
            ) : (
              'Se connecter'
            )}
          </button>
        </div>
      </section>

      <p className="mt-8 text-sm text-slate-400">
        © 2026 ChantierPro - Logiciel de suivi professionnel
      </p>
    </div>
  );
}

function LoginSessionLoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-panel">
        <div className="flex items-center justify-center gap-3 text-slate-700">
          <SpinnerIcon className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Verification de session...</span>
        </div>
      </div>
    </div>
  );
}

function EyeIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function EyeOffIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M9.88 9.88a3 3 0 1 0 4.24 4.24"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="m2 2 20 20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M21 12a9 9 0 1 1-6.219-8.56"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function AlertCircleIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      <path d="M12 16h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
