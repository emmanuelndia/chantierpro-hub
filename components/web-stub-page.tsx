'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/badge';
import { ConfirmModal } from '@/components/confirm-modal';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import type { DataTableColumn } from '@/types/ui';

type DemoRow = {
  id: string;
  primary: string;
  secondary: string;
  status: string;
  updatedAt: string;
};

type WebStubPageProps = Readonly<{
  title: string;
  description: string;
  eyebrow: string;
  ctaLabel?: string;
  ctaHref?: string;
  tableRows?: readonly DemoRow[];
}>;

export function WebStubPage({
  title,
  description,
  eyebrow,
  ctaLabel,
  ctaHref,
  tableRows = [],
}: WebStubPageProps) {
  const { pushToast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const columns = useMemo<readonly DataTableColumn<DemoRow>[]>(
    () => [
      {
        id: 'primary',
        header: 'Element',
        accessor: (row) => <span className="font-semibold text-ink">{row.primary}</span>,
        sortValue: (row) => row.primary,
        filterValue: (row) => `${row.primary} ${row.secondary}`,
      },
      {
        id: 'secondary',
        header: 'Contexte',
        accessor: (row) => row.secondary,
        sortValue: (row) => row.secondary,
        filterValue: (row) => row.secondary,
      },
      {
        id: 'status',
        header: 'Statut',
        accessor: (row) => (
          <Badge tone={row.status === 'Pret' ? 'success' : 'warning'}>{row.status}</Badge>
        ),
        sortValue: (row) => row.status,
        filterValue: (row) => row.status,
      },
      {
        id: 'updatedAt',
        header: 'Mise a jour',
        accessor: (row) => row.updatedAt,
        sortValue: (row) => row.updatedAt,
        filterValue: (row) => row.updatedAt,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/70 bg-gradient-to-br from-primary/10 via-white to-success/10 p-8 shadow-panel">
        <Badge tone="info">{eyebrow}</Badge>
        <h1 className="mt-5 text-3xl font-semibold text-ink sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">{description}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#163d6c]"
            onClick={() =>
              pushToast({
                type: 'success',
                title: 'Toast de demonstration',
                message: 'La notification se fermera automatiquement sous 4 secondes.',
              })
            }
            type="button"
          >
            Tester le toast
          </button>
          <button
            className="rounded-full border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
            onClick={() => setConfirmOpen(true)}
            type="button"
          >
            Ouvrir la confirmation
          </button>
        </div>
      </section>

      {tableRows.length > 0 ? (
        <DataTable
          columns={columns}
          pageSize={5}
          rowKey={(row) => row.id}
          rows={tableRows}
          searchPlaceholder="Filtrer les donnees de demonstration..."
        />
      ) : (
        <EmptyState
          {...(ctaHref ? { ctaHref } : {})}
          {...(ctaLabel ? { ctaLabel } : {})}
          description="Cette route est maintenant prete dans la navigation unifiee. Le branchement metier pourra se faire dans une iteration suivante sans refaire le shell."
          title="Ecran pret a brancher"
        />
      )}

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Badge
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="error">Error</Badge>
            <Badge tone="neutral">Neutral</Badge>
          </div>
        </article>
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel md:col-span-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Layout
          </p>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            Sidebar 240px, topbar 64px, drawer mobile, fil d Ariane dynamique, menu utilisateur,
            pages 403/404 et composants UI transverses sont deja en place.
          </p>
        </article>
      </section>

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Confirmer la suppression"
        description="Ce composant est pret pour les suppressions, archivages et autres actions destructrices."
        destructive
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          pushToast({
            type: 'warning',
            title: 'Action confirmee',
            message: 'Le ConfirmModal est branche et reutilisable.',
          });
        }}
        open={confirmOpen}
        title="Confirmation destructive"
      />
    </div>
  );
}
