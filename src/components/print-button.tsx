'use client';

import { Button } from '@/components/ui';

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="no-print">
      {label}
    </Button>
  );
}
