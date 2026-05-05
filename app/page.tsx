import { PlaceholderCard } from '@/components/placeholder-card';

const quickLinks = [
  { href: '/web/login', label: 'Accès web', description: 'Espace navigateur desktop.' },
  { href: '/mobile/login', label: 'Accès mobile', description: 'PWA mobile chantier.' },
  { href: '/api/health', label: 'API health', description: 'Validation de l’infrastructure backend.' },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-16">
      <div className="mb-10 max-w-3xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-primary">
          ChantierPro
        </p>
        <h1 className="text-4xl font-semibold text-ink sm:text-5xl">
          Socle Next.js 15 unifié pour le web et la PWA mobile
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          Cette base fournit l’architecture App Router, la couche Prisma/Neon, la PWA
          et les dossiers de travail communs pour les prochaines itérations produit.
        </p>
      </div>

      <section className="grid gap-5 md:grid-cols-3">
        {quickLinks.map((link) => (
          <PlaceholderCard
            key={link.href}
            href={link.href}
            title={link.label}
            description={link.description}
          />
        ))}
      </section>
    </main>
  );
}
