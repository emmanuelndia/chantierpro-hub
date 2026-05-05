'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import type { AuthErrorCode, LoginResponse } from '@/types/auth';

type LoginErrorPayload = {
  code?: AuthErrorCode;
  retryAfterSeconds?: number;
};

type AuthMode = 'login' | 'forgot' | 'forgot-sent';

const emailPattern =
  /^(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\u0001-\u0008\u000B\u000C\u000E-\u001F\u0021\u0023-\u005B\u005D-\u007F]|\\[\u0001-\u0009\u000B\u000C\u000E-\u007F])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|(?:\d{1,3}\.){3}\d{1,3})$/;

function normalizeNextPath(next: string | null) {
  if (!next?.startsWith('/mobile')) {
    return '/mobile/home';
  }

  return next;
}

function getInlineErrorMessage(code?: AuthErrorCode, retryAfterSeconds?: number) {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'Email ou mot de passe incorrect.';
    case 'ACCOUNT_DISABLED':
      return 'Ce compte est desactive. Contactez un administrateur.';
    case 'TOO_MANY_ATTEMPTS':
      return `Trop de tentatives. Reessayez dans ${retryAfterSeconds ?? 0} s.`;
    default:
      return 'Connexion impossible pour le moment.';
  }
}

export default function MobileLoginPage() {
  return (
    <Suspense fallback={<MobileAuthLoadingState />}>
      <MobileLoginContent />
    </Suspense>
  );
}

function MobileLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken, isAuthenticated, setAccessToken } = useAuth();
  const hydratedRef = useRef(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const [forgotEmailSentTo, setForgotEmailSentTo] = useState<string | null>(null);

  const nextPath = useMemo(() => normalizeNextPath(searchParams.get('next')), [searchParams]);
  const normalizedEmail = email.trim().toLowerCase();
  const emailIsValid = emailPattern.test(normalizedEmail);
  const canSubmitLogin =
    normalizedEmail.length > 0 &&
    password.length > 0 &&
    emailIsValid &&
    !isSubmitting &&
    retryAfterSeconds === 0;
  const canSubmitForgot = normalizedEmail.length > 0 && emailIsValid && !isSubmitting;

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
          setIsCheckingSession(false);
          return;
        }

        const payload = (await response.json()) as { accessToken: string };
        setAccessToken(payload.accessToken);
        router.replace(nextPath);
      } catch {
        setIsCheckingSession(false);
      }
    })();
  }, [accessToken, isAuthenticated, nextPath, router, setAccessToken]);

  useEffect(() => {
    if (retryAfterSeconds <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setRetryAfterSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [retryAfterSeconds]);

  async function handleLogin() {
    setEmailTouched(true);
    setPasswordTouched(true);
    setErrorMessage(null);

    if (!canSubmitLogin) {
      if (!emailIsValid) {
        setErrorMessage('Saisissez une adresse email valide.');
      }
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as LoginErrorPayload;
        const nextRetryAfter = payload.retryAfterSeconds ?? 0;
        setRetryAfterSeconds(nextRetryAfter);
        setErrorMessage(getInlineErrorMessage(payload.code, nextRetryAfter));
        return;
      }

      const payload = (await response.json()) as LoginResponse;
      setAccessToken(payload.accessToken);
      router.replace(nextPath);
    } catch {
      setErrorMessage('Connexion impossible. Verifiez votre reseau puis reessayez.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    setEmailTouched(true);
    setErrorMessage(null);

    if (!canSubmitForgot) {
      setErrorMessage('Saisissez une adresse email valide.');
      return;
    }

    setIsSubmitting(true);

    try {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 650);
      });
      setForgotEmailSentTo(normalizedEmail);
      setMode('forgot-sent');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setErrorMessage(null);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setErrorMessage(null);
  }

  function handleLoginKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleLogin();
    }
  }

  function handleForgotKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleForgotPassword();
    }
  }

  if (isCheckingSession) {
    return <MobileAuthLoadingState />;
  }

  return (
    <main className="min-h-dvh bg-[#0f172a] px-4 py-[calc(env(safe-area-inset-top)+1rem)] text-ink">
      <section className="mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top)-2rem)] w-full max-w-md flex-col overflow-hidden rounded-[2rem] bg-white shadow-[0_28px_80px_rgba(2,6,23,0.35)]">
        <header className="bg-slate-950 px-6 pb-6 pt-8 text-center text-white">
          <div className="text-2xl font-bold tracking-tight">
            CHANTIER<span className="text-orange-500">PRO</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {mode === 'login' ? 'Connexion' : 'Recuperation'}
          </p>
        </header>

        <div className="flex flex-1 flex-col px-6 py-7">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-[0_10px_26px_rgba(234,88,12,0.32)]">
              <HelmetIcon className="h-9 w-9" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-slate-950">
              {mode === 'login' ? 'Bienvenue !' : mode === 'forgot' ? 'Mot de passe oublie' : 'Demande envoyee'}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {mode === 'login'
                ? 'Connectez-vous a votre espace chantier.'
                : mode === 'forgot'
                  ? 'Indiquez votre email professionnel.'
                  : `Un lien de reinitialisation sera envoye a ${forgotEmailSentTo}.`}
            </p>
          </div>

          {mode === 'login' ? (
            <div className="mt-8 flex flex-1 flex-col">
              <MobileTextField
                autoComplete="email"
                error={emailTouched && email.length > 0 && !emailIsValid ? 'Email invalide.' : null}
                inputMode="email"
                label="Email professionnel"
                onBlur={() => setEmailTouched(true)}
                onChange={handleEmailChange}
                onKeyDown={handleLoginKeyDown}
                placeholder="martin.dupont@entreprise.fr"
                type="email"
                value={email}
              />

              <div className="mt-5">
                <MobilePasswordField
                  error={passwordTouched && password.length === 0 ? 'Mot de passe requis.' : null}
                  onBlur={() => setPasswordTouched(true)}
                  onChange={handlePasswordChange}
                  onKeyDown={handleLoginKeyDown}
                  showPassword={showPassword}
                  toggleShowPassword={() => setShowPassword((current) => !current)}
                  value={password}
                />
              </div>

              {errorMessage ? <InlineError message={errorMessage} /> : null}

              <button
                className="mt-7 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-orange-600 px-5 text-base font-bold text-white shadow-lg shadow-orange-600/25 transition active:scale-[0.98] hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                disabled={!canSubmitLogin}
                onClick={() => {
                  void handleLogin();
                }}
                type="button"
              >
                {isSubmitting ? <SpinnerIcon className="h-5 w-5 animate-spin" /> : <LoginIcon className="h-5 w-5" />}
                {retryAfterSeconds > 0 ? `Reessayer dans ${retryAfterSeconds}s` : isSubmitting ? 'Connexion...' : 'Se connecter'}
              </button>

              <button
                className="mx-auto mt-5 min-h-14 px-4 text-sm font-semibold text-orange-600"
                onClick={() => {
                  setMode('forgot');
                  setErrorMessage(null);
                }}
                type="button"
              >
                Mot de passe oublie ?
              </button>
            </div>
          ) : null}

          {mode === 'forgot' ? (
            <div className="mt-8 flex flex-1 flex-col">
              <MobileTextField
                autoComplete="email"
                error={emailTouched && email.length > 0 && !emailIsValid ? 'Email invalide.' : null}
                inputMode="email"
                label="Email professionnel"
                onBlur={() => setEmailTouched(true)}
                onChange={handleEmailChange}
                onKeyDown={handleForgotKeyDown}
                placeholder="martin.dupont@entreprise.fr"
                type="email"
                value={email}
              />

              {errorMessage ? <InlineError message={errorMessage} /> : null}

              <button
                className="mt-7 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-orange-600 px-5 text-base font-bold text-white shadow-lg shadow-orange-600/25 transition active:scale-[0.98] hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                disabled={!canSubmitForgot}
                onClick={() => {
                  void handleForgotPassword();
                }}
                type="button"
              >
                {isSubmitting ? <SpinnerIcon className="h-5 w-5 animate-spin" /> : <MailIcon className="h-5 w-5" />}
                Envoyer le lien
              </button>

              <button
                className="mx-auto mt-5 min-h-14 px-4 text-sm font-semibold text-slate-500"
                onClick={() => {
                  setMode('login');
                  setErrorMessage(null);
                }}
                type="button"
              >
                Retour a la connexion
              </button>
            </div>
          ) : null}

          {mode === 'forgot-sent' ? (
            <div className="mt-8 flex flex-1 flex-col">
              <div className="rounded-2xl border border-success/20 bg-success/10 p-4 text-sm leading-6 text-slate-700">
                Si un compte actif existe pour cet email, vous recevrez les instructions de
                reinitialisation dans quelques instants.
              </div>
              <button
                className="mt-7 min-h-14 w-full rounded-2xl bg-slate-950 px-5 text-base font-bold text-white transition active:scale-[0.98] hover:bg-slate-800"
                onClick={() => {
                  setMode('login');
                  setErrorMessage(null);
                }}
                type="button"
              >
                Retour a la connexion
              </button>
            </div>
          ) : null}

          <footer className="mt-7 border-t border-slate-200 pt-5 text-center text-xs text-slate-400">
            Version 2.0 - ChantierPro mobile
          </footer>
        </div>
      </section>
    </main>
  );
}

type MobileTextFieldProps = Readonly<{
  autoComplete: string;
  error: string | null;
  inputMode: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  type: string;
  value: string;
}>;

function MobileTextField({
  autoComplete,
  error,
  inputMode,
  label,
  onBlur,
  onChange,
  onKeyDown,
  placeholder,
  type,
  value,
}: MobileTextFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className={`min-h-14 w-full rounded-2xl border bg-slate-50 px-4 text-base text-slate-900 outline-none transition focus:bg-white ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100'
            : 'border-slate-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-100'
        }`}
        inputMode={inputMode}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {error ? <span className="mt-2 block text-sm font-medium text-red-600">{error}</span> : null}
    </label>
  );
}

function MobilePasswordField({
  error,
  onBlur,
  onChange,
  onKeyDown,
  showPassword,
  toggleShowPassword,
  value,
}: Readonly<{
  error: string | null;
  onBlur: () => void;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  showPassword: boolean;
  toggleShowPassword: () => void;
  value: string;
}>) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">Mot de passe</span>
      <span className="relative block">
        <input
          autoComplete="current-password"
          className={`min-h-14 w-full rounded-2xl border bg-slate-50 px-4 pr-14 text-base text-slate-900 outline-none transition focus:bg-white ${
            error
              ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100'
              : 'border-slate-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-100'
          }`}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="••••••••"
          type={showPassword ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          onClick={toggleShowPassword}
          type="button"
        >
          {showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
        </button>
      </span>
      {error ? <span className="mt-2 block text-sm font-medium text-red-600">{error}</span> : null}
    </label>
  );
}

function InlineError({ message }: Readonly<{ message: string }>) {
  return (
    <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-700">
      <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function MobileAuthLoadingState() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-6">
      <div className="flex w-full max-w-sm items-center justify-center gap-3 rounded-3xl bg-white p-7 text-slate-700 shadow-panel">
        <SpinnerIcon className="h-5 w-5 animate-spin" />
        <span className="text-sm font-semibold">Verification de session...</span>
      </div>
    </main>
  );
}

function baseIcon(className: string, children: React.ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function HelmetIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M4 14a8 8 0 0 1 16 0v4H4v-4Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function LoginIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M9 5H5v14h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M13 8l4 4-4 4M17 12H9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function MailIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m5 8 7 5 7-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}

function EyeIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function EyeOffIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="m2 2 20 20" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function SpinnerIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="M21 12a9 9 0 1 1-6.2-8.6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />,
  );
}

function AlertCircleIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 16.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </>,
  );
}
