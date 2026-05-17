'use client';

import Link from 'next/link';
import { Ellipsis } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

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
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const menuWidth = menu?.offsetWidth ?? 192;
      const menuHeight = menu?.offsetHeight ?? Math.max(actions.length * 44 + 12, 56);
      const gap = 8;
      const left = Math.min(Math.max(12, rect.right - menuWidth), window.innerWidth - menuWidth - 12);
      const belowTop = rect.bottom + gap;
      const top = belowTop + menuHeight <= window.innerHeight - 12 ? belowTop : Math.max(12, rect.top - menuHeight - gap);
      setPosition({ left, top });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [actions.length, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
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
    <div className="inline-flex">
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
        onClick={() => setOpen((current) => !current)}
        title="Actions"
        type="button"
      >
        <Ellipsis className="h-4 w-4" />
      </button>

      {open
        ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[70] min-w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"
          role="menu"
          style={position ?? { left: -9999, top: -9999 }}
        >
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
        </div>,
        document.body,
          )
        : null}
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
