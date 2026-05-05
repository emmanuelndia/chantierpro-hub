import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(27,79,138,0.15),transparent_32%),linear-gradient(180deg,#f8fbff_0%,#edf2f7_100%)] px-6 py-16">
      <section className="w-full max-w-2xl rounded-[2rem] border border-white/70 bg-white/90 p-10 text-center shadow-panel backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-danger">Erreur 403</p>
        <h1 className="mt-4 text-4xl font-semibold text-ink">Acces refuse</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Cette route existe bien, mais ton role ne permet pas d y acceder. La navigation web
          unifiee masque deja les menus non autorises, mais une URL directe reste protegee ici.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#163d6c]"
            href="/web/dashboard"
          >
            Retour au tableau de bord
          </Link>
          <Link
            className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            href="/login"
          >
            Revenir a la connexion
          </Link>
        </div>
      </section>
    </main>
  );
}
