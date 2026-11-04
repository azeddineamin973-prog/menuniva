import type { LanguageCode } from '@/generated/prisma/enums';
import ar from './ar';
import en, { type UiText } from './en';
import es from './es';
import fr from './fr';
import pt from './pt';

export type { UiText };
const UI: Record<LanguageCode, UiText> = { pt, en, fr, ar, es };

/** Shared interface words for one language (server side; client components use `useUiText`). */
export function getUiText(lang: LanguageCode): UiText {
  return UI[lang] ?? en;
}
