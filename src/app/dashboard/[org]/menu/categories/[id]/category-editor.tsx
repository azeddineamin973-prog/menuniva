'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Card, CardBody, Checkbox, Field, Input, Select } from '@/components/ui';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { saveCategoryAction } from '../../actions';

type T = { name: string; description: string };
/** Same value as the server's NO_PREPARATION (that module is server-only). */
const NO_PREPARATION = 'NO_PREPARATION';

export function CategoryEditor({
  org,
  base,
  id,
  source,
  languages,
  stations,
  initial,
}: {
  org: string;
  base: string;
  id: string;
  source: LanguageCode;
  languages: LanguageCode[];
  stations: { id: string; name: string }[];
  initial: { defaultStationId: string | null; isActive: boolean; translations: Partial<Record<LanguageCode, T>> };
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const ordered = [source, ...languages.filter((l) => l !== source)];
  const tr = (l: LanguageCode) => v.translations[l] ?? { name: '', description: '' };
  return (
    <Card>
      <CardBody>
        <ActionForm action={saveCategoryAction} submitLabel="Save category" onSuccess={() => router.push(`${base}/menu`)}>
          <input type="hidden" name="org" value={org} />
          <input
            type="hidden"
            name="payload"
            value={JSON.stringify({
              id,
              defaultStationId: v.defaultStationId && v.defaultStationId !== NO_PREPARATION ? v.defaultStationId : null,
              noPreparation: v.defaultStationId === NO_PREPARATION,
              isActive: v.isActive,
              translations: Object.fromEntries(ordered.map((l) => [l, tr(l)])),
            })}
          />
          <div className="grid gap-4 md:grid-cols-2">
            {ordered.map((l) => (
              <Field key={l} label={`Name — ${LANGUAGE_NATIVE_NAME[l]}${l === source ? ' (source)' : ''}`} htmlFor={`c-${l}`} hint={l !== source && !tr(l).name ? 'Translation required' : undefined}>
                <Input id={`c-${l}`} dir={l === 'ar' ? 'rtl' : 'ltr'} value={tr(l).name} required={l === source} onChange={(e) => setV({ ...v, translations: { ...v.translations, [l]: { ...tr(l), name: e.target.value } } })} />
              </Field>
            ))}
          </div>
          <Field label="Default preparation station" htmlFor="station" hint="Dishes in this category go to this station unless the dish says otherwise.">
            <Select id="station" value={v.defaultStationId ?? ''} onChange={(e) => setV({ ...v, defaultStationId: e.target.value || null })}>
              <option value="">— none —</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value={NO_PREPARATION}>No preparation — handed over at the counter</option>
            </Select>
          </Field>
          <Checkbox label="Show this category on the menu" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
        </ActionForm>
      </CardBody>
    </Card>
  );
}
