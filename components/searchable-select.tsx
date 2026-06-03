'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
};

type SearchableSelectProps = Readonly<{
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  allowClear?: boolean;
}>;

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  emptyLabel = 'Aucun resultat.',
  disabled = false,
  className = '',
  allowClear = true,
}: SearchableSelectProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedOption = options.find((option) => option.value === value);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) =>
      `${option.label} ${option.description ?? ''} ${option.keywords ?? ''}`.toLowerCase().includes(normalizedQuery),
    );
  }, [options, query]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="relative">
        <input
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-20 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            setQuery('');
          }}
          placeholder={placeholder}
          type="search"
          value={isOpen ? query : selectedOption?.label ?? ''}
        />
        <div className="absolute inset-y-0 right-3 flex items-center gap-1">
          {allowClear && value && !disabled ? (
            <button
              aria-label="Effacer la selection"
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={() => {
                onChange('');
                setQuery('');
                setIsOpen(false);
              }}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </div>
      </div>

      {selectedOption?.description && !isOpen ? (
        <p className="mt-1 text-xs font-semibold text-slate-500">{selectedOption.description}</p>
      ) : null}

      {isOpen && !disabled ? (
        <div className="absolute z-40 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
          {filteredOptions.length === 0 ? (
            <p className="px-3 py-2 text-xs font-semibold text-slate-500">{emptyLabel}</p>
          ) : (
            filteredOptions.slice(0, 40).map((option) => {
              const selected = option.value === value;
              return (
                <button
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    selected ? 'bg-slate-950 text-white' : 'text-slate-800 hover:bg-slate-50'
                  }`}
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setQuery('');
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{option.label}</span>
                    {option.description ? (
                      <span className={`block truncate text-xs font-semibold ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
