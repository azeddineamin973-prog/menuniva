import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, Card, CardBody, CardHeader, Input, PageHeader } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { getTranslationGrid } from '@/server/services/translations';
import { requireTenantPage } from '@/server/tenant';
import { approveTranslationAction, bulkTranslateAction, markTranslationsReviewedAction, saveTranslationAction } from '../actions';

export default async function TranslationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'menu.edit');
  const grid = await getTranslationGrid(ctx);
  const { org: o, rows } = grid;
  const others = o.enabledLanguages.filter((l) => l !== o.sourceLanguage);
  return (
    <>
      <PageHeader
        title="Translations"
        description="Review every language before guests see it. Machine translations stay hidden from guests until approved here."
        actions={
          <ActionForm action={markTranslationsReviewedAction} submitLabel="Mark translations as reviewed" submitVariant="dark" successText="Recorded">
            <input type="hidden" name="org" value={ctx.org.slug} />
          </ActionForm>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-5"><p className="text-sm text-muted">Translations required</p><p className="mt-1 text-2xl font-semibold" data-testid="missing-count">{grid.missing}</p></Card>
        <Card className="p-5"><p className="text-sm text-muted">Machine translations awaiting review</p><p className="mt-1 text-2xl font-semibold">{grid.unreviewed}</p></Card>
        <Card className="p-5">
          <p className="text-sm text-muted">Automatic translation</p>
          {grid.provider.configured ? (
            <div className="mt-2">
              <ActionForm action={bulkTranslateAction} submitLabel={`Translate missing with ${grid.provider.label}`} successText="Done — please review">
                <input type="hidden" name="org" value={ctx.org.slug} />
              </ActionForm>
            </div>
          ) : (
            <p className="mt-1 text-sm"><Badge>Needs configuration</Badge> <span className="text-muted">No provider set. Use the editor below.</span></p>
          )}
        </Card>
      </div>
      {grid.provider.configured && <div className="mb-4"><Alert tone="info">Automatic translation never translates ingredients or allergens. Always check dish names for accuracy.</Alert></div>}
      {rows.length === 0 ? (
        <Alert tone="info">Your menu has no categories or dishes yet.</Alert>
      ) : others.length === 0 ? (
        <Alert tone="info">Only one language is enabled. Enable more languages in Settings.</Alert>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const src = r.cells[o.sourceLanguage];
            return (
              <Card key={`${r.kind}-${r.id}`}>
                <CardHeader title={src?.name ?? '(no source name)'} description={r.kind === 'category' ? 'Category' : 'Dish'} />
                <CardBody className="grid gap-3 lg:grid-cols-2">
                  {others.map((l) => {
                    const c = r.cells[l];
                    return (
                      <div key={l} className="rounded-xl border border-line p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-medium">{LANGUAGE_NATIVE_NAME[l]}</span>
                          {!c ? <Badge tone="warning">Translation required</Badge> : c.status === 'MACHINE' ? <Badge tone="info">Machine — not yet shown</Badge> : <Badge tone="success">Reviewed</Badge>}
                        </div>
                        <ActionForm action={saveTranslationAction} submitLabel="Save" submitVariant="secondary" className="space-y-2">
                          <input type="hidden" name="org" value={ctx.org.slug} />
                          <input type="hidden" name="kind" value={r.kind} />
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="language" value={l} />
                          <Input name="name" dir={l === 'ar' ? 'rtl' : 'ltr'} defaultValue={c?.name ?? ''} placeholder={`Name in ${LANGUAGE_NATIVE_NAME[l]}`} aria-label={`Name in ${LANGUAGE_NATIVE_NAME[l]}`} data-testid={`tr-${r.kind}-${l}`} />
                          {r.kind === 'product' && <Input name="description" dir={l === 'ar' ? 'rtl' : 'ltr'} defaultValue={c?.description ?? ''} placeholder="Description (optional)" aria-label="Description" />}
                        </ActionForm>
                        {c?.status === 'MACHINE' && (
                          <div className="mt-2">
                            <InlineAction action={approveTranslationAction} fields={{ org: ctx.org.slug, kind: r.kind, id: r.id, language: l }} label="Approve as is" variant="primary" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
