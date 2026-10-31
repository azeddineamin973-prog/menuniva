import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Icon } from './icons';

/** Server-rendered pagination with links (`?page=n`), keeps the other query parameters. */
export function Pagination({ page, pages, href, total, label = 'items' }: { page: number; pages: number; href: (p: number) => string; total?: number; label?: string }) {
  if (pages <= 1) return total !== undefined ? <p className="px-1 text-xs text-muted">{total} {label}</p> : null;
  const btn = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-line bg-surface px-2 text-[13px] shadow-xs hover:bg-surface-2 pointer-coarse:h-10 pointer-coarse:min-w-10';
  const off = 'pointer-events-none opacity-40';
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Pagination">
      <p className="text-xs text-muted">
        Page {page} of {pages}
        {total !== undefined && ` · ${total} ${label}`}
      </p>
      <div className="flex gap-1.5">
        <Link href={href(page - 1)} className={cn(btn, page <= 1 && off)} aria-disabled={page <= 1} aria-label="Previous page">
          <Icon name="chevronLeft" className="rtl:rotate-180" />
        </Link>
        <Link href={href(page + 1)} className={cn(btn, page >= pages && off)} aria-disabled={page >= pages} aria-label="Next page">
          <Icon name="chevronRight" className="rtl:rotate-180" />
        </Link>
      </div>
    </nav>
  );
}
