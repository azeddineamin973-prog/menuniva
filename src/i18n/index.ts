import type { LanguageCode } from '@/generated/prisma/enums';
import ar from './messages/ar';
import en, { type Messages } from './messages/en';
import es from './messages/es';
import fr from './messages/fr';
import pt from './messages/pt';

export type { Messages };
export * from './config';

const DICTIONARIES: Record<LanguageCode, Messages> = { pt, en, fr, ar, es };

/** Interface language used when nobody has chosen one. Restaurant menu content keeps its own language. */
export const DEFAULT_UI_LANGUAGE: LanguageCode = 'en';

export function getMessages(lang: LanguageCode): Messages {
  return DICTIONARIES[lang] ?? DICTIONARIES[DEFAULT_UI_LANGUAGE];
}
