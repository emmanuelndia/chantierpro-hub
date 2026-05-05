import type { ReactNode } from 'react';

type WebAuthLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function WebAuthLayout({ children }: WebAuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(27,79,138,0.18),transparent_32%),linear-gradient(180deg,#f8fbff_0%,#eef4fa_100%)] px-6 py-16">
      <div className="w-full max-w-xl">{children}</div>
    </main>
  );
}
