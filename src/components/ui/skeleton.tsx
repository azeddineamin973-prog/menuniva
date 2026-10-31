import { cn } from '@/lib/cn';

/** Placeholder block shown while live data loads (animation respects reduced motion via globals.css). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-2', className)} aria-hidden />;
}
