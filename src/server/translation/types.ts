import 'server-only';
import type { LanguageCode } from '@/generated/prisma/enums';

/**
 * Translation provider abstraction (Part 4).
 *
 * - With no provider configured, MenuNiva keeps the original text and marks other languages
 *   as "Translation required". Nothing is invented.
 * - Provider output is stored with status MACHINE and is NOT shown to guests until a staff
 *   member reviews it (status REVIEWED).
 * - Allergen and ingredient safety information is never machine-translated automatically.
 */
export interface TranslationProvider {
  readonly id: 'none' | 'deepl' | 'libretranslate' | 'openrouter';
  readonly label: string;
  isConfigured(): boolean;
  /** Answers must be the same length and order as `texts`; callers rely on the positions. */
  translate(texts: string[], from: LanguageCode, to: LanguageCode): Promise<string[]>;
}

export class TranslationUnavailableError extends Error {}
