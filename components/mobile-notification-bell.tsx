'use client';

import { Bell, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

type MobileNotificationBellProps = Readonly<{
  count: number;
  title: string;
  emptyText: string;
  children: ReactNode;
}>;

export function MobileNotificationBell({ children, count, emptyText, title }: MobileNotificationBellProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-label={count > 0 ? `${count} notification(s)` : 'Notifications'}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition active:scale-[0.97]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Bell className="h-5 w-5" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Notifications</p>
                <h2 className="mt-1 text-lg font-black text-slate-950">{title}</h2>
              </div>
              <button
                aria-label="Fermer les notifications"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
              {count > 0 ? children : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
                  {emptyText}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
