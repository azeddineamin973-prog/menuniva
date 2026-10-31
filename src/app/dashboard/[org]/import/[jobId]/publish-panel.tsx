'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, Checkbox, Select, disclosureClass } from '@/components/ui';
import { publishImportAction } from '../actions';

const NO_STATION = 'NO_STATION';

/**
 * The last step: where the dishes are prepared, photo rights, and the save button. Imported
 * products are saved as drafts; only a price from the restaurant's own file can make a dish
 * visible, and only when the owner asks for it.
 */
export function PublishPanel({
  org,
  jobId,
  toCreate,
  photos,
  ownPhotos,
  canMakeVisible,
  platformPrices,
  stations,
  stationTargets,
  stationsHref,
  before,
  after,
  newCategories,
  translationNote,
}: {
  org: string;
  jobId: string;
  toCreate: number;
  /** Photos from the source, copied only with the rights confirmation below. */
  photos: number;
  /** Photos the owner uploaded during review; rights were confirmed at upload. */
  ownPhotos: number;
  canMakeVisible: boolean;
  platformPrices: boolean;
  stations: { id: string; name: string }[];
  stationTargets: { label: string; isNew: boolean }[];
  stationsHref: string;
  before: { products: number; categories: number };
  after: { products: number; categories: number };
  newCategories: string[];
  translationNote: string | null;
}) {
  const [all, setAll] = useState('');
  const [per, setPer] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(false);
  const products = `${toCreate} ${toCreate === 1 ? 'product' : 'products'}`;
  const label = visible ? `Import ${products}` : `Save ${products} as drafts`;
  const stationOptions = (
    <>
      {stations.map((st) => (
        <option key={st.id} value={st.id}>
          {st.name}
        </option>
      ))}
      <option value={NO_STATION}>No station (no kitchen ticket)</option>
    </>
  );

  return (
    <section id="finish" className="scroll-mt-6 rounded-[var(--radius-card)] border border-line bg-surface" aria-labelledby="finish-title" data-testid="publish-panel">
      <div className="border-b border-line px-5 py-4">
        <h2 id="finish-title" className="text-base font-semibold text-ink">
          Save to your menu
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          {platformPrices
            ? 'Products are saved as drafts. Glovo prices are kept as reference prices — add your own dine-in prices before guests can order.'
            : 'Products are saved as drafts unless you choose to show priced dishes now.'}
        </p>
      </div>
      <div className="p-5">
        <ActionForm action={publishImportAction} submitLabel={label} testId="publish-import-form" className="space-y-6">
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="jobId" value={jobId} />

          {stationTargets.length > 0 && (
            <fieldset className="space-y-3" data-testid="import-stations">
              <legend className="text-sm font-medium text-ink">Where are these dishes prepared?</legend>
              <p className="-mt-2 text-xs text-muted">Orders for a category go to that kitchen or café screen.</p>
              {stations.length === 0 ? (
                <Alert tone="warning">
                  No kitchen stations exist yet, so imported dishes will not reach a kitchen screen.{' '}
                  <Link href={stationsHref} className="font-medium underline">
                    Create stations
                  </Link>{' '}
                  first, or save now and set them later.
                </Alert>
              ) : (
                <>
                  <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    <span className="text-muted">{stationTargets.length > 1 ? `All ${stationTargets.length} categories` : stationTargets[0].label}</span>
                    {/* max-w, not w-: the kit's Select already sets w-full, and w-full would win. */}
                    <Select
                      value={all}
                      onChange={(e) => {
                        setAll(e.target.value);
                        setPer(Object.fromEntries(stationTargets.map((t) => [t.label, e.target.value])));
                      }}
                      className="max-w-64 text-sm"
                      aria-label="Station for all categories"
                      data-testid="station-all"
                    >
                      <option value="">Choose a station…</option>
                      {stationOptions}
                    </Select>
                  </label>
                  <details open={stationTargets.length <= 6} className="group">
                    <summary className={disclosureClass}>Choose per category</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {stationTargets.map((t) => (
                        <label key={t.label} className="block rounded-xl border border-line p-2.5 text-sm">
                          <span className="mb-1.5 block truncate text-xs font-medium text-ink" title={t.label}>
                            {t.label}
                            {t.isNew && <span className="ms-1 font-normal text-muted">· new</span>}
                          </span>
                          <Select
                            name={`station:${t.label}`}
                            value={per[t.label] ?? ''}
                            onChange={(e) => setPer((p) => ({ ...p, [t.label]: e.target.value }))}
                            className="h-9! text-xs pointer-coarse:h-11! pointer-coarse:text-base"
                            aria-label={`Station for ${t.label}`}
                            data-testid="import-station-select"
                          >
                            <option value="">Choose…</option>
                            {stationOptions}
                          </Select>
                        </label>
                      ))}
                    </div>
                  </details>
                </>
              )}
            </fieldset>
          )}

          <div className="space-y-3">
            {photos > 0 && (
              <Checkbox
                name="imageRights"
                label={`Copy ${photos} ${photos === 1 ? 'photo' : 'photos'} from the platform to my menu`}
                description="I confirm I have the right to use these photos. Without this, those products are saved without photos."
                data-testid="image-rights"
              />
            )}
            {ownPhotos > 0 && (
              <p className="text-xs text-muted" data-testid="own-photos-note">
                {ownPhotos} {ownPhotos === 1 ? 'photo' : 'photos'} you uploaded will be added automatically.
              </p>
            )}
            {canMakeVisible && (
              <Checkbox
                name="makeVisible"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
                label="Show priced dishes to guests now"
                description="Only dishes priced in your own file. Platform prices are never used for your orders."
              />
            )}
            <Checkbox name="confirm" label="I reviewed the products" data-testid="confirm-review" />
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl bg-surface-2/70 px-4 py-3 text-xs text-muted" data-testid="before-after">
            <span>
              Dishes <span className="tabular-nums">{before.products}</span> → <strong className="text-ink tabular-nums">{after.products}</strong>
            </span>
            <span>
              Categories <span className="tabular-nums">{before.categories}</span> → <strong className="text-ink tabular-nums">{after.categories}</strong>
              {newCategories.length > 0 && <span> ({newCategories.length} new)</span>}
            </span>
            {translationNote && <span>{translationNote}</span>}
            <span>Allergens are never imported as verified.</span>
          </div>
        </ActionForm>
      </div>
    </section>
  );
}
