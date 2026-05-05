import Link from 'next/link';

type PlaceholderCardProps = Readonly<{
  href: string;
  title: string;
  description: string;
}>;

export function PlaceholderCard({ href, title, description }: PlaceholderCardProps) {
  return (
    <Link
      href={href}
      className="rounded-[1.75rem] border border-[color:var(--border)] bg-[color:var(--card)] p-6 shadow-panel transition hover:-translate-y-1"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary/70">
        Route de départ
      </p>
      <h2 className="mt-3 text-2xl font-semibold text-ink">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
      <span className="mt-6 inline-flex rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
        Ouvrir
      </span>
    </Link>
  );
}
