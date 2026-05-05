import type { ReactNode } from 'react';
import type { BadgeTone } from '@/types/ui';

type BadgeProps = Readonly<{
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}>;

const toneClassName: Record<BadgeTone, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-orange-100 text-orange-700',
  error: 'bg-red-100 text-red-700',
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-blue-100 text-blue-700',
};

export function Badge({ children, tone = 'neutral', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${toneClassName[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
