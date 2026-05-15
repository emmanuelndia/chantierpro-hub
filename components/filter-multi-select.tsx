'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type FilterMultiSelectOption = {
  value: string;
  label: string;
};

export function FilterMultiSelect({
  options,
  values,
  placeholder,
  onChange,
}: Readonly<{
  options: FilterMultiSelectOption[];
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOptions = options.filter((option) => values.includes(option.value));

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
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

  function toggleValue(value: string) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm transition hover:bg-white focus:border-orange-500 focus:bg-white"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={selectedOptions.length > 0 ? 'font-medium text-slate-900' : 'text-slate-400'}>
          {selectedOptions.length > 0
            ? selectedOptions.length === 1
              ? selectedOptions[0]?.label
              : `${selectedOptions.length} selectionnes`
            : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {selectedOptions.length > 0 ? (
        <div className="mt-2 flex min-h-7 flex-wrap gap-1.5">
          {selectedOptions.slice(0, 2).map((option) => (
            <span key={option.value} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              <span className="truncate">{option.label}</span>
              <button
                aria-label={`Retirer ${option.label}`}
                className="rounded-full p-0.5 hover:bg-slate-200"
                onClick={() => toggleValue(option.value)}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selectedOptions.length > 2 ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              +{selectedOptions.length - 2}
            </span>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-full min-w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="max-h-64 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">Aucune option disponible.</p>
            ) : (
              options.map((option) => {
                const selected = values.includes(option.value);
                return (
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                    key={option.value}
                    onClick={() => toggleValue(option.value)}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${selected ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200'}`}>
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {values.length > 0 ? (
            <button
              className="mt-2 w-full rounded-xl border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              onClick={() => onChange([])}
              type="button"
            >
              Effacer la selection
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
