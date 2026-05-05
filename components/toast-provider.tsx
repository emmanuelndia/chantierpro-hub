'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ToastInput, ToastTone } from '@/types/ui';

type ToastRecord = ToastInput & {
  id: number;
};

type ToastContextValue = {
  pushToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClassName: Record<ToastTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-orange-200 bg-orange-50 text-orange-900',
  info: 'border-blue-200 bg-blue-50 text-blue-900',
};

export function WebToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current;
      nextId.current += 1;
      setItems((current) => [...current, { id, ...toast }]);
      window.setTimeout(() => dismissToast(id), 4000);
    },
    [dismissToast],
  );

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-full max-w-sm flex-col gap-3">
        {items.map((item) => (
          <article
            key={item.id}
            className={`pointer-events-auto rounded-2xl border p-4 shadow-panel ${toneClassName[item.type]}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{item.title}</p>
                {item.message ? <p className="mt-1 text-sm opacity-80">{item.message}</p> : null}
              </div>
              <button
                aria-label="Fermer"
                className="rounded-full p-1 text-current/70 transition hover:bg-white/60 hover:text-current"
                onClick={() => dismissToast(item.id)}
                type="button"
              >
                <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M6 6l12 12M18 6 6 18"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
            </div>
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used inside WebToastProvider');
  }

  return context;
}
