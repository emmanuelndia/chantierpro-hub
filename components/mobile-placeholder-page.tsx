type MobilePlaceholderPageProps = Readonly<{
  title: string;
  description: string;
  badge: string;
}>;

export function MobilePlaceholderPage({ title, description, badge }: MobilePlaceholderPageProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
        {badge}
      </span>
      <h2 className="mt-4 text-2xl font-semibold text-ink">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-medium text-slate-500">
        Ecran mobile pret a brancher sur la prochaine iteration metier.
      </div>
    </section>
  );
}
