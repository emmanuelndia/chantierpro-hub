import type { ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'error' | 'neutral' | 'info';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export type ToastInput = {
  title: string;
  message?: string;
  type: ToastTone;
};

export type DataTableColumn<T> = {
  id: string;
  header: string;
  accessor: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string;
  filterValue?: (row: T) => string;
  className?: string;
};
