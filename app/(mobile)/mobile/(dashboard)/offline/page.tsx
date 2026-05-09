import Link from 'next/link';

export default function MobileOfflinePage() {
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-orange-200 bg-orange-50 p-5">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Mode hors ligne</p>
        <h1 className="mt-2 text-2xl font-black text-slate-950">Donnees hors ligne indisponibles</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
          Ouvrez ChantierPro avec internet, puis lancez la preparation offline depuis la synchronisation avant
          d&apos;aller sur une zone sans reseau.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-3">
        <Link
          className="flex min-h-12 items-center justify-center rounded-lg bg-slate-950 px-4 py-3 text-sm font-black text-white"
          href="/mobile/sync"
        >
          Aller a la synchronisation
        </Link>
        <Link
          className="flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700"
          href="/mobile/home"
        >
          Retour accueil
        </Link>
      </div>
    </div>
  );
}
