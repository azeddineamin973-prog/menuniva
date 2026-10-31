import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Data table primitives. Wide tables scroll inside their card (never the page); on phones pages
 * should prefer a stacked list (`hidden sm:table-cell` columns + a summary line in the first cell).
 */
export function TableWrap({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mn-scroll overflow-x-auto', className)} {...props} />;
}
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />;
}
export function THead({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('border-b border-line bg-surface-2/60 text-[12px] text-muted', className)} {...props} />;
}
export function TH({ className, ...props }: ComponentProps<'th'>) {
  return <th scope="col" className={cn('px-4 py-2.5 text-start font-medium whitespace-nowrap first:ps-4 sm:first:ps-5 last:pe-4 sm:last:pe-5', className)} {...props} />;
}
export function TR({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('border-b border-line transition-colors last:border-0 hover:bg-surface-2/50', className)} {...props} />;
}
export function TD({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-middle first:ps-4 sm:first:ps-5 last:pe-4 sm:last:pe-5', className)} {...props} />;
}
