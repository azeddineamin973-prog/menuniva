import { describe, expect, it } from 'vitest';
import type { LanguageCode } from '@/generated/prisma/enums';
import { DEFAULT_UI_LANGUAGE, getMessages } from '@/i18n';
import { uploadMessage } from '@/lib/upload-messages';

describe('English is the default interface language', () => {
  it('falls back to English for an unknown language', () => {
    expect(DEFAULT_UI_LANGUAGE).toBe('en');
    expect(getMessages('xx' as LanguageCode).auth.signUp).toBe('Create account');
  });

  it('keeps every other language working', () => {
    expect(getMessages('pt').auth.signOut).toBe('Terminar sessão');
    expect(getMessages('en').auth.signOut).toBe('Sign out');
  });

  it('upload messages default to English when the page language is unknown', () => {
    expect(uploadMessage('no_file', null)).toBe(uploadMessage('no_file', 'en'));
    expect(uploadMessage('no_file', 'pt-PT')).not.toBe(uploadMessage('no_file', 'en'));
  });
});
