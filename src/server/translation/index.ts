import 'server-only';
import type { LanguageCode } from '@/generated/prisma/enums';
import { env } from '../env';
import { OpenRouterProvider, standInModelFetch } from './openrouter';
import { TranslationUnavailableError, type TranslationProvider } from './types';

export { TranslationUnavailableError };
export type { TranslationProvider };

const DEEPL_LANG: Record<LanguageCode, string> = { pt: 'PT-PT', en: 'EN-GB', fr: 'FR', ar: 'AR', es: 'ES' };
const DEEPL_SOURCE: Record<LanguageCode, string> = { pt: 'PT', en: 'EN', fr: 'FR', ar: 'AR', es: 'ES' };

class NoneProvider implements TranslationProvider {
  readonly id = 'none' as const;
  readonly label = 'No translation provider configured';
  isConfigured() {
    return false;
  }
  async translate(): Promise<string[]> {
    throw new TranslationUnavailableError('No translation provider is configured.');
  }
}

class DeepLProvider implements TranslationProvider {
  readonly id = 'deepl' as const;
  readonly label = 'DeepL API';
  isConfigured() {
    return !!env.DEEPL_API_KEY;
  }
  async translate(texts: string[], from: LanguageCode, to: LanguageCode) {
    if (!this.isConfigured()) throw new TranslationUnavailableError('DEEPL_API_KEY is missing.');
    const host = env.DEEPL_API_KEY!.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const res = await fetch(`${host}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts, source_lang: DEEPL_SOURCE[from], target_lang: DEEPL_LANG[to] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new TranslationUnavailableError(`DeepL error ${res.status}`);
    const body = (await res.json()) as { translations: { text: string }[] };
    return body.translations.map((t) => t.text);
  }
}

class LibreTranslateProvider implements TranslationProvider {
  readonly id = 'libretranslate' as const;
  readonly label = 'LibreTranslate server';
  isConfigured() {
    return !!env.LIBRETRANSLATE_URL;
  }
  async translate(texts: string[], from: LanguageCode, to: LanguageCode) {
    if (!this.isConfigured()) throw new TranslationUnavailableError('LIBRETRANSLATE_URL is missing.');
    const out: string[] = [];
    for (const q of texts) {
      const res = await fetch(new URL('/translate', env.LIBRETRANSLATE_URL).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, source: from, target: to, format: 'text', api_key: env.LIBRETRANSLATE_API_KEY || undefined }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new TranslationUnavailableError(`LibreTranslate error ${res.status}`);
      out.push(((await res.json()) as { translatedText: string }).translatedText);
    }
    return out;
  }
}

export function getTranslationProvider(): TranslationProvider {
  switch (env.TRANSLATION_PROVIDER) {
    case 'deepl':
      return new DeepLProvider();
    case 'libretranslate':
      return new LibreTranslateProvider();
    case 'openrouter':
      // In the browser suite the model is answered locally (see standInModelFetch), so the real
      // translation code runs end to end without a billed request leaving the machine.
      return new OpenRouterProvider(env.APP_ENV === 'test' && env.TEST_FETCH_FIXTURES ? standInModelFetch() : fetch);
    default:
      return new NoneProvider();
  }
}
