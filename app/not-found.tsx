import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,rgba(39,174,96,0.12),transparent_24%),linear-gradient(180deg,#f8fbff_0%,#edf2f7_100%)] px-6 py-16">
      <section className="w-full max-w-2xl rounded-[2rem] border border-white/70 bg-white/90 p-10 text-center shadow-panel backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">Erreur 404</p>
        <h1 className="mt-4 text-4xl font-semibold text-ink">Page introuvable</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          La route demandee n existe pas encore ou a ete deplacee dans la nouvelle navigation web
          unifiee.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#163d6c]"
            href="/web/dashboard"
          >
            Aller au tableau de bord
          </Link>
          <Link
            className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            href="/"
          >
            Retour accueil
          </Link>
        </div>
      </section>
    </main>
  );
}
