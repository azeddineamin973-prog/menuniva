'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Button, Card, CardBody, CardHeader, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { saveScheduleAction } from './actions';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Range = { days: number[]; start: string; end: string };

export function ScheduleEditor({ org, target, id, initial }: { org: string; target: 'product' | 'category'; id: string; initial: Range[] }) {
  const router = useRouter();
  const [ranges, setRanges] = useState<Range[]>(initial);
  const upd = (i: number, patch: Partial<Range>) => setRanges(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Card>
      <CardHeader
        title="Availability schedule"
        description={ranges.length === 0 ? 'Always available while ordering is open.' : 'Only orderable during these times (location time zone). Outside them guests see “Not available now”.'}
      />
      <CardBody>
        <ActionForm action={saveScheduleAction} submitLabel="Save schedule" onSuccess={() => router.refresh()} testId="schedule-form">
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="payload" value={JSON.stringify({ target, id, ranges })} />
          {ranges.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
              <div className="flex gap-1">
                {DAYS.map((d, k) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={r.days.includes(k)}
                    onClick={() => upd(i, { days: r.days.includes(k) ? r.days.filter((x) => x !== k) : [...r.days, k] })}
                    className={cn('h-8 w-10 rounded-lg border text-xs', r.days.includes(k) ? 'border-graphite bg-graphite text-white' : 'border-line')}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <Input type="time" className="w-28" value={r.start} aria-label="From" onChange={(e) => upd(i, { start: e.target.value })} />
              <span>–</span>
              <Input type="time" className="w-28" value={r.end} aria-label="Until" onChange={(e) => upd(i, { end: e.target.value })} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setRanges(ranges.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setRanges([...ranges, { days: [1, 2, 3, 4, 5], start: '12:00', end: '15:00' }])}>
            + Add time range
          </Button>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

