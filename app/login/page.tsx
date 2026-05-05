import { redirect } from 'next/navigation';

type LoginAliasPageProps = Readonly<{
  searchParams?: Promise<{
    next?: string;
  }>;
}>;

export default async function LoginAliasPage({ searchParams }: LoginAliasPageProps) {
  const resolvedSearchParams = await searchParams;
  const next = resolvedSearchParams?.next;

  if (next) {
    redirect(`/web/login?next=${encodeURIComponent(next)}`);
  }

  redirect('/web/login');
}
