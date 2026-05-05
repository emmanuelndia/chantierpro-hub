'use client';

import { AlertCircleIcon, RefreshCwIcon } from 'lucide-react';

type MobileReportsErrorStateProps = Readonly<{
  message: string;
  detail?: string;
  onRetry?: () => void;
}>;

export function MobileReportsErrorState({ 
  message, 
  detail, 
  onRetry 
}: MobileReportsErrorStateProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-red-800">
            {message}
          </h3>
          {detail && (
            <p className="mt-1 text-xs text-red-600">
              {detail}
            </p>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-200 active:scale-[0.98]"
            >
              <RefreshCwIcon className="h-3 w-3" />
              Réessayer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type MobileReportsEmptyStateProps = Readonly<{
  message: string;
  description?: string;
}>;

export function MobileReportsEmptyState({ 
  message, 
  description 
}: MobileReportsEmptyStateProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-slate-200 flex items-center justify-center mb-4">
        <AlertCircleIcon className="h-6 w-6 text-slate-400" />
      </div>
      <h3 className="text-sm font-semibold text-slate-700 mb-1">
        {message}
      </h3>
      {description && (
        <p className="text-xs text-slate-500">
          {description}
        </p>
      )}
    </div>
  );
}

type MobileReportsLoadingStateProps = Readonly<{
  count?: number;
}>;

export function MobileReportsLoadingState({ count = 3 }: MobileReportsLoadingStateProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="animate-pulse">
          <div className="h-20 rounded-lg bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
