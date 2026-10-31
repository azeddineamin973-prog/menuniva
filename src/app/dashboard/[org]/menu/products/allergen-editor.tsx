'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox } from '@/components/ui';
import type { Messages } from '@/i18n';
import { cn } from '@/lib/cn';
import { saveAllergensAction } from '../actions';

const CODES = ['GLUTEN', 'CRUSTACEANS', 'EGGS', 'FISH', 'PEANUTS', 'SOYBEANS', 'MILK', 'NUTS', 'CELERY', 'MUSTARD', 'SESAME', 'SULPHITES', 'LUPIN', 'MOLLUSCS'] as const;
type Presence = 'NONE' | 'CONTAINS' | 'MAY_CONTAIN';

export function AllergenEditor({
  org,
  productId,
  labels,
  initial,
  verifiedAt,
  hasUnverifiedSuggestions,
}: {
  org: string;
  productId: string;
  labels: Messages['allergens'];
  initial: Partial<Record<(typeof CODES)[number], 'CONTAINS' | 'MAY_CONTAIN'>>;
  verifiedAt: string | null;
  hasUnverifiedSuggestions: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, Presence>>(Object.fromEntries(CODES.map((c) => [c, initial[c] ?? 'NONE'])));
  const [verify, setVerify] = useState(false);
  const declarations = Object.entries(state)
    .filter(([, p]) => p !== 'NONE')
    .map(([allergen, presence]) => ({ allergen, presence }));
  return (
    <Card>
      <CardHeader
        title="Allergens (EU 14)"
        description="Guests only see allergen information after you confirm it has been verified. Never guess."
        action={verifiedAt ? <Badge tone="success">Verified {verifiedAt.slice(0, 10)}</Badge> : <Badge tone="warning">Not verified — hidden from guests</Badge>}
      />
      <CardBody>
        {hasUnverifiedSuggestions && (
          <div className="mb-4">
            <Alert tone="warning">Some allergen data came from an import and has not been verified.</Alert>
          </div>
        )}
        <ActionForm action={saveAllergensAction} submitLabel="Save allergens" onSuccess={() => router.refresh()} testId="allergen-form">
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="payload" value={JSON.stringify({ declarations, verify })} />
          <div className="grid gap-2 sm:grid-cols-2">
            {CODES.map((c) => (
              <div key={c} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                <span className="text-sm">{labels[c]}</span>
                <div className="flex overflow-hidden rounded-lg border border-line text-xs" role="group" aria-label={labels[c]}>
                  {(['NONE', 'CONTAINS', 'MAY_CONTAIN'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setState({ ...state, [c]: p })}
                      aria-pressed={state[c] === p}
                      className={cn('min-h-8 px-2.5 pointer-coarse:min-h-10', state[c] === p ? (p === 'NONE' ? 'bg-surface-2 font-medium' : 'bg-graphite text-white dark:bg-lime dark:text-graphite') : 'text-muted hover:bg-surface-2')}
                    >
                      {p === 'NONE' ? 'No' : p === 'CONTAINS' ? 'Contains' : 'May contain'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <Checkbox
              checked={verify}
              onChange={(e) => setVerify(e.target.checked)}
              label="I confirm this allergen information has been checked by the restaurant and is accurate."
              description="Required before guests can see it. Saving without this box keeps the information hidden."
            />
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
