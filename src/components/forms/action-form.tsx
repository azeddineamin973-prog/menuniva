'use client';

import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { createContext, useActionState, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/cn';
import { DEFAULT_UPLOAD_MAX_BYTES, parseUploadErrorCode, uploadMessage } from '@/lib/upload-messages';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (prev: any, form: FormData) => Promise<ActionResult<any>>;

const FieldErrorsContext = createContext<Record<string, string>>({});

const FRIENDLY: Record<string, string> = {
  invalid_phone: 'Enter a valid phone number, e.g. +351 935 413 677.',
  invalid_url: 'Enter a full link starting with https://',
  https_required: 'The link must start with https://',
  wrong_domain: 'This link does not belong to the expected website.',
  invalid_postal_pt: 'Use the Portuguese format 0000-000.',
  invalid_postal_es: 'Use the Spanish format 00000.',
  default_must_be_enabled: 'The default language must be one of the enabled languages.',
  source_must_be_enabled: 'The source language must be one of the enabled languages.',
};

export function friendlyError(code: string, langTag?: string | null): string {
  if (FRIENDLY[code]) return FRIENDLY[code];
  const upload = parseUploadErrorCode(code);
  if (upload) return uploadMessage(upload.code, langTag, upload.maxBytes);
  if (code === 'request_failed') return uploadMessage('request_failed', langTag);
  if (/^Too (small|big)|^Invalid|^String must|^Expected/i.test(code)) return 'Please check this value.';
  return code;
}

export function useFieldError(name: string): string | undefined {
  const errors = useContext(FieldErrorsContext);
  const e = errors[name];
  return e ? friendlyError(e) : undefined;
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
  submitLabel = 'Save',
  className,
  resetOnSuccess = false,
  successText = 'Saved',
  hiddenSubmit = false,
  submitVariant = 'primary',
  testId,
  onSuccess,
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
  const [shown, setShown] = useState<ActionResult<unknown> | null>(null);
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
  useEffect(() => {
    if (state === initialActionState) return;
    setShown(state);
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state.data);
      const t = setTimeout(() => setShown(null), 4000);
      return () => clearTimeout(t);
    }
  }, [state, resetOnSuccess, onSuccess]);
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
        <div className={cn('flex flex-wrap items-center gap-3', hiddenSubmit && 'hidden')}>
          <Button type="submit" disabled={pending} variant={submitVariant}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
          {shown?.ok && (
            <span className="text-sm font-medium text-success" role="status">
              ✓ {successText}
            </span>
          )}
        </div>
        {shown && !shown.ok && shown.error && (
          <Alert tone="danger">
            {shown.error === 'validation' ? 'Some fields need attention. Please check the highlighted fields.' : friendlyError(shown.error, uiLang())}
          </Alert>
        )}
      </form>
    </FieldErrorsContext.Provider>
  );
}
