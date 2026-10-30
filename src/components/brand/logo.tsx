import { cn } from '@/lib/cn';

/**
 * MenuNiva mark: a rounded menu card containing a QR finder pattern, QR modules and a
 * serving cloche. Original artwork.
 */
export function LogoMark({ className, title = 'MenuNiva' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8 shrink-0', className)} role="img" aria-label={title}>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#171A1D" />
      <rect x="13" y="13" width="16" height="16" rx="4" fill="none" stroke="#B9FF36" strokeWidth="3.5" />
      <rect x="18.5" y="18.5" width="5" height="5" rx="1.2" fill="#B9FF36" />
      <rect x="35" y="13" width="5" height="5" rx="1.2" fill="#B9FF36" />
      <rect x="44" y="13" width="7" height="5" rx="1.2" fill="#B9FF36" opacity=".55" />
      <rect x="35" y="22" width="5" height="7" rx="1.2" fill="#B9FF36" opacity=".55" />
      <rect x="13" y="35" width="7" height="5" rx="1.2" fill="#B9FF36" opacity=".55" />
      <rect x="13" y="44" width="5" height="7" rx="1.2" fill="#B9FF36" />
      <path d="M30 47a12 12 0 0 1 24 0z" fill="#B9FF36" />
      <rect x="27" y="48.5" width="30" height="3.5" rx="1.75" fill="#B9FF36" />
      <circle cx="42" cy="32.6" r="2.3" fill="#B9FF36" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && (
        <span className="text-[1.15rem] font-semibold tracking-tight text-ink">
          Menu<span className="rounded-md bg-graphite px-1 text-lime dark:bg-transparent dark:px-0">Niva</span>
        </span>
      )}
    </span>
  );
}
