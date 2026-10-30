import type { LanguageCode } from '@/generated/prisma/enums';

export const LANGUAGES: readonly LanguageCode[] = ['pt', 'en', 'fr', 'ar', 'es'] as const;

/** BCP-47 tags used for `lang` attributes and Intl formatting. */
export const LANGUAGE_TAG: Record<LanguageCode, string> = {
  pt: 'pt-PT',
  en: 'en',
  fr: 'fr',
  ar: 'ar',
  es: 'es',
};

export const LANGUAGE_NATIVE_NAME: Record<LanguageCode, string> = {
  pt: 'Português',
  en: 'English',
  fr: 'Français',
  ar: 'العربية',
  es: 'Español',
};

export function isRtl(lang: LanguageCode): boolean {
  return lang === 'ar';
}

export function dirOf(lang: LanguageCode): 'rtl' | 'ltr' {
  return isRtl(lang) ? 'rtl' : 'ltr';
}

export function isLanguage(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export const LANG_COOKIE = 'mn_lang';

/** Simple `{name}` interpolation. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
