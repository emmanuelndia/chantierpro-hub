'use client';

import Link from 'next/link';
import { Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type TableActionItem = {
  label: string;
  icon: ReactNode;
  href?: string;
  navigation?: 'client' | 'download';
  onClick?: () => void;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
  disabled?: boolean;
};

export function TableActionsMenu({ actions }: Readonly<{ actions: TableActionItem[] }>) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
        onClick={() => setOpen((current) => !current)}
        title="Actions"
        type="button"
      >
        <Ellipsis className="h-4 w-4" />
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-20 min-w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl" role="menu">
          {actions.map((action) => {
            const className = `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${getToneClassName(action.tone)}`;
            const content = (
              <>
                {action.icon}
                {action.label}
              </>
            );

            if (action.href && action.navigation === 'client') {
              return (
                <Link
                  className={className}
                  href={action.href}
                  key={action.label}
                  onClick={() => setOpen(false)}
                  role="menuitem"
                >
                  {content}
                </Link>
              );
            }

            if (action.href) {
              return (
                <a className={className} href={action.href} key={action.label} onClick={() => setOpen(false)} role="menuitem">
                  {content}
                </a>
              );
            }

            return (
              <button
                className={className}
                disabled={action.disabled}
                key={action.label}
                onClick={() => {
                  setOpen(false);
                  action.onClick?.();
                }}
                role="menuitem"
                type="button"
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function getToneClassName(tone: TableActionItem['tone']) {
  switch (tone) {
    case 'warning':
      return 'text-orange-700 hover:bg-orange-50';
    case 'danger':
      return 'text-red-700 hover:bg-red-50';
    case 'success':
      return 'text-emerald-700 hover:bg-emerald-50';
    default:
      return 'text-slate-700 hover:bg-slate-50';
  }
}
