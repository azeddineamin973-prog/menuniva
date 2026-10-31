'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { cn } from '@/lib/cn';
import { detectSourceLanguageAction, translatePassAction } from '../actions';

export type AiPlanView = {
  cells: number;
  requests: number;
  characters: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  unreviewed: number;
  sourceLanguageName: string;
  targetNames: string[];
  provider: { id: string; label: string; configured: boolean; model: string | null; isAi: boolean };
  cost: { estimatedUsd: number; inputPerMillionUsd: number; outputPerMillionUsd: number } | null;
};

const usd = (n: number) => (n < 0.01 ? `less than $0.01` : `about $${n.toFixed(2)}`);
const int = (n: number) => n.toLocaleString('en-GB');

/**
 * "Translate all with AI", with the three things an owner needs around it: what it will cost
 * before it starts, honest progress while it runs, and what failed when it does not finish.
 *
 * Translation runs in bounded passes. Each pass is a separate request that skips whatever is
 * already translated, so a long menu makes steady progress instead of one request timing out,
 * and a failed batch is simply retried by the next pass.
 */
export function AiTranslatePanel({ org, plan }: { org: string; plan: AiPlanView }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [created, setCreated] = useState(0);
  const [remaining, setRemaining] = useState(plan.cells);
  const [errors, setErrors] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [detect, setDetect] = useState<{ detected: string | null; agrees: boolean } | null>(null);
  const total = plan.cells;

  const run = async () => {
    setRunning(true);
    setErrors([]);
    setFinished(false);
    setCreated(0);
    let done = 0;
    // Bounded: 60 passes × 120 cells covers a very large menu and can never loop forever.
    for (let pass = 0; pass < 60; pass++) {
      const res = await translatePassAction({ org });
      if (!res.ok) {
        setErrors([res.error]);
        break;
      }
      const data = res.data!;
      done += data.created;
      setCreated(done);
      setRemaining(data.remaining);
      if (data.errors.length) setErrors((e) => [...new Set([...e, ...data.errors])]);
      // No progress means every remaining batch is failing; stop instead of hammering the provider.
      if (data.remaining === 0 || data.created === 0) break;
    }
    setRunning(false);
    setFinished(true);
    router.refresh();
  };

  const checkLanguage = async () => {
    const res = await detectSourceLanguageAction({ org });
    if (res.ok && res.data) setDetect({ detected: res.data.detected, agrees: res.data.agrees });
  };

  if (!plan.provider.configured) {
    return (
      <Card data-testid="ai-panel">
        <CardHeader title="Translate with AI" description="Fills every missing language from your menu text, for you to check." action={<Badge>Needs configuration</Badge>} />
        <CardBody className="space-y-2 text-sm">
          <p className="text-muted">
            No translation provider is connected, so nothing is translated automatically. Add an OpenRouter key as <code className="rounded bg-surface-2 px-1">OPENROUTER_API_KEY</code> on the server and set{' '}
            <code className="rounded bg-surface-2 px-1">TRANSLATION_PROVIDER=openrouter</code>.
          </p>
          <p className="text-muted">You can still write every translation by hand below — nothing is invented in the meantime.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-testid="ai-panel">
      <CardHeader
        title="Translate with AI"
        description={`${plan.provider.label}${plan.provider.model ? ` · ${plan.provider.model}` : ''}`}
        action={total === 0 ? <Badge tone="success">Nothing missing</Badge> : <Badge tone="lime">{int(total)} to translate</Badge>}
      />
      <CardBody className="space-y-4">
        {total > 0 && (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Missing translations</dt>
              <dd className="text-lg font-semibold tabular-nums" data-testid="ai-cells">{int(total)}</dd>
            </div>
            <div>
              <dt className="text-muted">Requests</dt>
              <dd className="text-lg font-semibold tabular-nums">{int(plan.requests)}</dd>
            </div>
            <div>
              <dt className="text-muted">Estimated tokens</dt>
              <dd className="text-lg font-semibold tabular-nums">{int(plan.estimatedInputTokens + plan.estimatedOutputTokens)}</dd>
            </div>
            <div>
              <dt className="text-muted">Estimated cost</dt>
              <dd className="text-lg font-semibold tabular-nums" data-testid="ai-cost">{plan.cost ? usd(plan.cost.estimatedUsd) : 'unknown'}</dd>
            </div>
          </dl>
        )}
        {total > 0 && (
          <p className="text-xs text-muted">
            From {plan.sourceLanguageName} into {plan.targetNames.join(', ')}. Only dish and category names and descriptions are sent — never ingredients, allergens or anything about your customers.
            {plan.cost
              ? ` Priced at $${plan.cost.inputPerMillionUsd.toFixed(2)} per million input tokens and $${plan.cost.outputPerMillionUsd.toFixed(2)} per million output tokens; the real amount is billed by OpenRouter.`
              : ' The price for this model could not be read, so the cost is unknown.'}
          </p>
        )}

        {running || finished ? (
          <div className="space-y-2" data-testid="ai-progress">
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={created}>
              <div className={cn('h-full rounded-full transition-all', errors.length ? 'bg-warning' : 'bg-lime')} style={{ width: `${total ? Math.min(100, (created / total) * 100) : 100}%` }} />
            </div>
            <p className="text-sm" role="status">
              {running ? 'Translating…' : 'Finished.'} <span className="font-medium tabular-nums">{int(created)}</span> translated
              {remaining > 0 && <> · <span className="tabular-nums">{int(remaining)}</span> still missing</>}
            </p>
          </div>
        ) : null}

        {errors.length > 0 && (
          <div data-testid="ai-errors">
            <Alert tone="warning" title="Some items could not be translated">
              <ul className="list-disc ps-5">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <p className="mt-1">Everything that did succeed is saved. Press the button again to retry only what is still missing.</p>
            </Alert>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={run} disabled={running || total === 0} data-testid="translate-all">
            {running ? 'Translating…' : finished && remaining > 0 ? 'Retry what is missing' : `Translate all with AI${total ? ` (${int(total)})` : ''}`}
          </Button>
          <Button type="button" variant="secondary" onClick={checkLanguage} disabled={running} data-testid="detect-language">
            Check my menu language
          </Button>
        </div>

        {detect && (
          <div data-testid="detect-result">
            {detect.agrees ? (
              <Alert tone="success">Your menu text matches the source language you configured ({plan.sourceLanguageName}).</Alert>
            ) : (
              <Alert tone="warning" title="Your source language may be wrong">
                Your menu text looks like <strong>{detect.detected}</strong>, but the source language is set to {plan.sourceLanguageName}. Translating from the wrong original produces poor results. Change the
                source language in Settings if this is wrong — nothing was changed automatically.
              </Alert>
            )}
          </div>
        )}

        <Alert tone="info">
          AI translations are saved as <strong>not yet approved</strong>. Guests keep seeing your original text until you approve them, so a bad translation can never reach a customer on its own.
        </Alert>
      </CardBody>
    </Card>
  );
}

/** Translates one row's missing languages, for fixing a single dish without running everything. */
export function RowTranslateButton({ org, kind, id }: { org: string; kind: 'category' | 'product'; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        data-testid="row-translate"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await translatePassAction({ org, only: [{ kind, id }] });
          if (!res.ok) setError(res.error);
          else if (res.data!.errors.length) setError(res.data!.errors[0]);
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? 'Translating…' : 'Translate with AI'}
      </Button>
      {error && (
        <span role="alert" className="ms-2 text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}
