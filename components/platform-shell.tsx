import type { ReactNode } from 'react';
import Link from 'next/link';
import type { NavigationItem } from '@/types/navigation';

type PlatformShellProps = Readonly<{
  title: string;
  description: string;
  navigation: readonly NavigationItem[];
  accentClassName: string;
  children: ReactNode;
}>;

export function PlatformShell({
  title,
  description,
  navigation,
  accentClassName,
  children,
}: PlatformShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10">
      <section
        className={`rounded-[2rem] border border-white/70 bg-gradient-to-br ${accentClassName} p-8 shadow-panel`}
      >
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.24em] text-primary">
          Infrastructure prête à étendre
        </p>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold text-ink sm:text-4xl">{title}</h1>
            <p className="mt-3 text-base leading-7 text-slate-600">{description}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#163d6c]"
              href="/api/health"
            >
              Tester `/api/health`
            </Link>
            <Link
              className="rounded-full border border-primary/20 bg-white/80 px-5 py-3 text-sm font-semibold text-primary transition hover:bg-white"
              href="/"
            >
              Retour accueil
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {navigation.map((item) => (
          <Link
            key={item.href}
            className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--card)] p-5 shadow-panel transition hover:-translate-y-1"
            href={item.href}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/70">
              {item.label}
            </p>
            <p className="mt-2 text-base font-semibold text-ink">{item.title}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
          </Link>
        ))}
      </section>

      <section className="mt-8">{children}</section>
    </main>
  );
}
