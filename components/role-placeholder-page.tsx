type RolePlaceholderPageProps = Readonly<{
  platform: 'Web' | 'Mobile';
  title: string;
  description: string;
  badge: string;
}>;

export function RolePlaceholderPage({
  platform,
  title,
  description,
  badge,
}: RolePlaceholderPageProps) {
  return (
    <section className="rounded-[2rem] border border-[color:var(--border)] bg-[color:var(--card)] p-8 shadow-panel">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
          {platform}
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
          {badge}
        </span>
      </div>
      <h2 className="mt-5 text-3xl font-semibold text-ink">{title}</h2>
      <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{description}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <InfoBlock label="Statut" value="Placeholder prêt" tone="bg-success/15 text-success" />
        <InfoBlock label="Type" value="App Router" tone="bg-primary/15 text-primary" />
        <InfoBlock label="Étape suivante" value="Brancher la logique métier" tone="bg-warning/15 text-[#9c6f00]" />
      </div>
    </section>
  );
}

type InfoBlockProps = Readonly<{
  label: string;
  value: string;
  tone: string;
}>;

function InfoBlock({ label, value, tone }: InfoBlockProps) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-3 inline-flex rounded-full px-3 py-2 text-sm font-semibold ${tone}`}>
        {value}
      </p>
    </article>
  );
}
