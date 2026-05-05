'use client';

import { useMemo, useState } from 'react';
import type { DataTableColumn } from '@/types/ui';

type DataTableProps<T> = Readonly<{
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
}>;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  searchPlaceholder = 'Filtrer...',
  pageSize = 5,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const nextRows =
      normalizedQuery.length === 0
        ? [...rows]
        : rows.filter((row) =>
            columns.some((column) =>
              (column.filterValue?.(row) ?? '')
                .toLowerCase()
                .includes(normalizedQuery),
            ),
          );

    if (!sortColumn) {
      return nextRows;
    }

    const column = columns.find((item) => item.id === sortColumn);

    if (!column?.sortValue) {
      return nextRows;
    }

    const sortValue = column.sortValue;

    return [...nextRows].sort((left, right) => {
      const leftValue = sortValue(left);
      const rightValue = sortValue(right);

      if (leftValue === rightValue) {
        return 0;
      }

      const comparison = leftValue > rightValue ? 1 : -1;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [columns, query, rows, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleSort(column: DataTableColumn<T>) {
    if (!column.sortValue) {
      return;
    }

    setPage(1);
    setSortDirection((currentDirection) =>
      sortColumn === column.id ? (currentDirection === 'asc' ? 'desc' : 'asc') : 'asc',
    );
    setSortColumn(column.id);
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[color:var(--border)] bg-white shadow-panel">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">Tableau de donnees</h3>
          <p className="text-sm text-slate-500">Tri, filtre et pagination inclus.</p>
        </div>
        <label className="relative block w-full max-w-xs">
          <span className="sr-only">Filtre</span>
          <input
            className="w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-primary focus:bg-white"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            value={query}
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.id} className="px-5 py-3 font-semibold">
                  <button
                    className={`inline-flex items-center gap-2 ${column.sortValue ? 'cursor-pointer hover:text-slate-900' : 'cursor-default'}`}
                    onClick={() => toggleSort(column)}
                    type="button"
                  >
                    {column.header}
                    {sortColumn === column.id ? (
                      <span className="text-[10px] uppercase tracking-[0.16em]">
                        {sortDirection}
                      </span>
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.length > 0 ? (
              visibleRows.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-slate-50">
                  {columns.map((column) => (
                    <td key={column.id} className={`px-5 py-4 text-slate-700 ${column.className ?? ''}`}>
                      {column.accessor(row)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-5 py-8 text-center text-slate-500" colSpan={columns.length}>
                  Aucun resultat pour ce filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
        <p>
          Page {safePage} / {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            type="button"
          >
            Precedent
          </button>
          <button
            className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage === totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            type="button"
          >
            Suivant
          </button>
        </div>
      </div>
    </section>
  );
}
