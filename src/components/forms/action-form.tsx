'use client';

import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { createContext, useActionState, useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Button, wrapButtonClass, Icon } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/cn';
import { DEFAULT_UPLOAD_MAX_BYTES, parseUploadErrorCode, uploadMessage } from '@/lib/upload-messages';
import { useUiText } from '@/components/ui-text';
import enUi, { type UiText } from '@/i18n/ui/en';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (prev: any, form: FormData) => Promise<ActionResult<any>>;

const FieldErrorsContext = createContext<Record<string, string>>({});

/** A known error code in the page's language (`t` from useUiText); unknown text is shown as sent. */
export function friendlyError(code: string, langTag?: string | null, t: UiText = enUi): string {
  const known = (t.friendly as Record<string, string>)[code];
  if (known) return known;
  const upload = parseUploadErrorCode(code);
  if (upload) return uploadMessage(upload.code, langTag, upload.maxBytes);
  if (code === 'request_failed') return uploadMessage('request_failed', langTag);
  if (/^Too (small|big)|^Invalid|^String must|^Expected/i.test(code)) return t.checkValue;
  return code;
}

export function useFieldError(name: string): string | undefined {
  const errors = useContext(FieldErrorsContext);
  const t = useUiText();
  const e = errors[name];
  return e ? friendlyError(e, null, t) : undefined;
}

export function FieldError({ name }: { name: string }) {
  const e = useFieldError(name);
  return e ? (
    <p className="mt-1 text-xs font-medium text-danger" role="alert">
      {e}
    </p>
  ) : null;
}

/**
 * Form bound to a server action. Shows saved/error state, exposes field errors to
 * <FieldError name="..."/>, and optionally resets after success.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className,
  resetOnSuccess = false,
  successText,
  hiddenSubmit = false,
  submitVariant = 'primary',
  testId,
  onSuccess,
  stickySubmit = false,
}: {
  action: Action;
  children: React.ReactNode;
  submitLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  successText?: string;
  hiddenSubmit?: boolean;
  submitVariant?: 'primary' | 'secondary' | 'dark' | 'danger';
  testId?: string;
  onSuccess?: (data: unknown) => void;
  /** Long forms: the save button stays visible at the bottom of the screen while the form is in view. */
  stickySubmit?: boolean;
}) {
  // A request refused before our server code runs (e.g. Next.js body limit for an oversized photo)
  // used to crash the whole page; it now becomes a form error (audit BUG-06).
  const safeAction = async (prev: ActionResult<unknown>, form: FormData): Promise<ActionResult<unknown>> => {
    try {
      return await action(prev, form);
    } catch (e) {
      const digest = (e as { digest?: unknown } | null)?.digest;
      if (typeof digest === 'string' && digest.startsWith('NEXT_')) throw e; // redirect() / notFound()
      const big = [...form.values()].some((v) => typeof v === 'object' && 'size' in v && (v as File).size > DEFAULT_UPLOAD_MAX_BYTES);
      return { ok: false, error: big ? `upload:image_too_large:${DEFAULT_UPLOAD_MAX_BYTES}` : 'request_failed' };
    }
  };
  const [state, formAction, pending] = useActionState<ActionResult<unknown>, FormData>(safeAction, initialActionState);
  const t = useUiText();
  const [shown, setShown] = useState<ActionResult<unknown> | null>(null);
  // Language of the page around the form, read when a message is shown (the DOM is needed for it).
  const [shownLang, setShownLang] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  const uiLang = () => ref.current?.closest('[lang]')?.getAttribute('lang') ?? null;
  /** Checks chosen files against data-max-bytes (default 5 MB) before anything is uploaded. */
  const checkFiles = (form: HTMLFormElement): string | null => {
    for (const input of Array.from(form.querySelectorAll<HTMLInputElement>('input[type=file]'))) {
      const max = Number(input.dataset.maxBytes) || DEFAULT_UPLOAD_MAX_BYTES;
      for (const f of Array.from(input.files ?? [])) {
        if (f.size > max) return uploadMessage(input.accept.includes('image') ? 'image_too_large' : 'file_too_large', uiLang(), max);
      }
    }
    return null;
  };
  const submit = keepValuesOnSubmit(formAction);
  // Once per result: callers pass inline callbacks, which must not re-run the effect (a new
  // function each render would call onSuccess again after every re-render, e.g. router.refresh()).
  const succeeded = useEffectEvent((data: unknown) => onSuccess?.(data));
  useEffect(() => {
    if (state === initialActionState) return;
    setShown(state);
    setShownLang(uiLang());
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      succeeded(state.data);
      const t = setTimeout(() => setShown(null), 4000);
      return () => clearTimeout(t);
    }
  }, [state, resetOnSuccess]);
  const fieldErrors = !state.ok && state.fieldErrors ? state.fieldErrors : {};
  return (
    <FieldErrorsContext.Provider value={fieldErrors}>
      <form
        ref={ref}
        onSubmit={(e) => {
          const err = checkFiles(e.currentTarget);
          setFileError(err);
          if (err) return e.preventDefault();
          submit(e);
        }}
        onChange={(e) => {
          if ((e.target as unknown as HTMLInputElement).type === 'file') setFileError(checkFiles(e.currentTarget));
        }}
        className={cn('space-y-4', className)}
        data-testid={testId}
      >
        {children}
        {fileError && (
          <div data-testid="file-error">
            <Alert tone="danger">{fileError}</Alert>
          </div>
        )}
        <div
          className={cn(
            'flex flex-wrap items-center gap-3',
            hiddenSubmit && 'hidden',
            // Above the phone bottom bar (4 rem); at the screen edge from `lg`, where there is none.
            stickySubmit && 'sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:bottom-0 lg:-mx-8 lg:px-8',
          )}
          data-testid={stickySubmit ? 'sticky-submit' : undefined}
        >
          <Button type="submit" disabled={pending} variant={submitVariant} className={wrapButtonClass}>
            {pending ? t.saving : (submitLabel ?? t.save)}
          </Button>
          {shown?.ok && (
            <span className="animate-fade-in inline-flex items-center gap-1.5 text-sm font-medium text-success" role="status">
              <Icon name="checkCircle" className="size-4" /> {successText ?? t.saved}
            </span>
          )}
        </div>
        {shown && !shown.ok && shown.error && (
          <Alert tone="danger">
            {shown.error === 'validation' ? t.fieldsNeedAttention : friendlyError(shown.error, shownLang, t)}
          </Alert>
        )}
      </form>
    </FieldErrorsContext.Provider>
  );
}
