'use client';

import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, Icon } from '@/components/ui';
import { arrangeProductImageAction, removeProductImageAction, uploadProductImageAction } from '../actions';

export type ManagedPhoto = { id: string; url: string; origin: string };

/**
 * All of a dish's photos in one place. The first photo is the main one: it is what the menu list
 * and the guest menu show. A new upload becomes the main photo unless "Add as an extra photo" is
 * chosen, so changing a dish's picture is one step.
 */
export function PhotoManager({ org, productId, photos, maxPhotos, maxBytes }: { org: string; productId: string; photos: ManagedPhoto[]; maxPhotos: number; maxBytes: number }) {
  const full = photos.length >= maxPhotos;
  const f = (imageId: string, extra: Record<string, string> = {}) => ({ org, imageId, ...extra });

  return (
    <Card id="photos" className="scroll-mt-20" data-testid="photo-manager">
      <CardHeader title="Photos" description="The main photo is shown on your menu and to guests. Only use photos you own or have permission to use." />
      <CardBody className="space-y-5">
        {photos.length === 0 ? (
          <p className="text-sm text-muted" data-testid="no-photos">
            No photo yet. Guests see the dish without a picture.
          </p>
        ) : (
          // Cards keep at least 10rem: the card sits in a half-width column on wide screens, and a
          // fixed column count made the buttons spill over the next photo.
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
            {photos.map((p, i) => (
              <li key={p.id} className={`flex flex-col rounded-xl border p-2 ${i === 0 ? 'border-graphite ring-1 ring-graphite dark:border-lime dark:ring-lime' : 'border-line'}`} data-testid="managed-photo">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="aspect-square w-full rounded-lg bg-surface-2 object-cover" />
                  {p.origin === 'IMPORTED' && <span className="absolute end-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">Imported</span>}
                </div>
                <div className="mt-2">
                  {i === 0 ? (
                    <Badge tone="lime" className="h-8 w-full justify-center" data-testid="main-photo-badge">
                      Main photo
                    </Badge>
                  ) : (
                    // InlineAction renders an inline <form>; the wrapper makes it span the card.
                    <div className="[&>form]:block">
                      <InlineAction action={arrangeProductImageAction} fields={f(p.id, { move: 'main' })} label="Make main" className="w-full" testId="make-main" />
                    </div>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="flex">
                    <InlineAction action={arrangeProductImageAction} fields={f(p.id, { move: 'left' })} label={<Icon name="arrowLeft" className="size-4 rtl:rotate-180" />} title="Move earlier" variant="ghost" className={`px-2! ${i === 0 ? 'invisible' : ''}`} />
                    <InlineAction action={arrangeProductImageAction} fields={f(p.id, { move: 'right' })} label={<Icon name="arrowRight" className="size-4 rtl:rotate-180" />} title="Move later" variant="ghost" className={`px-2! ${i === photos.length - 1 ? 'invisible' : ''}`} />
                  </span>
                  <InlineAction action={removeProductImageAction} fields={f(p.id)} label="Remove" variant="ghost" className="px-2! text-danger" confirm="Remove this photo? It is deleted from your menu." testId="remove-photo" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {full ? (
          <p className="text-sm text-muted">A dish can have up to {maxPhotos} photos. Remove one to add another.</p>
        ) : (
          <ActionForm action={uploadProductImageAction} submitLabel={photos.length ? 'Upload photo' : 'Add photo'} resetOnSuccess successText="Photo saved" testId="upload-photo-form" className="space-y-3 border-t border-line pt-4">
            <input type="hidden" name="org" value={org} />
            <input type="hidden" name="productId" value={productId} />
            <Field label={photos.length ? 'New photo' : 'Photo'} htmlFor="image" hint="PNG, JPEG or WebP, up to 5 MB.">
              <Input id="image" name="image" type="file" accept="image/png,image/jpeg,image/webp" data-max-bytes={maxBytes} required className="pt-2" />
            </Field>
            {photos.length > 0 && (
              <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <legend className="sr-only">Where should the new photo go?</legend>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 pointer-coarse:min-h-10">
                  <input type="radio" name="placement" value="main" defaultChecked className="size-4 accent-[#7ac70c]" />
                  Make it the main photo
                </label>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 pointer-coarse:min-h-10">
                  <input type="radio" name="placement" value="extra" className="size-4 accent-[#7ac70c]" />
                  Add as an extra photo
                </label>
              </fieldset>
            )}
            <Checkbox name="rightsConfirmed" label="I have the right to publish this photo." />
          </ActionForm>
        )}
      </CardBody>
    </Card>
  );
}
