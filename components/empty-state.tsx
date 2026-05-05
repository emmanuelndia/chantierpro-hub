import Link from 'next/link';

type EmptyStateProps = Readonly<{
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
}>;

export function EmptyState({ title, description, ctaLabel, ctaHref }: EmptyStateProps) {
  return (
    <section className="rounded-3xl border border-[color:var(--border)] bg-white p-8 text-center shadow-panel">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <svg
          aria-hidden="true"
          className="h-10 w-10"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="M5 18h14M7 15l2.5-3 2 2 3.5-5L17 12l2 3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      </div>
      <h2 className="mt-5 text-2xl font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-600">{description}</p>
      {ctaLabel && ctaHref ? (
        <Link
          className="mt-6 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#163d6c]"
          href={ctaHref}
        >
          {ctaLabel}
        </Link>
      ) : null}
    </section>
  );
}
