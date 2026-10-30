import 'server-only';
import type { LanguageCode } from '@/generated/prisma/enums';
import { db } from '../db';
import { getRequestLang } from '../request-lang';

/** Guest language: their choice (cookie) if the restaurant enabled it, else the restaurant default. */
export async function resolveGuestLanguage(org: { defaultLanguage: LanguageCode; enabledLanguages: LanguageCode[] }, override?: string | null): Promise<LanguageCode> {
  if (override && (org.enabledLanguages as string[]).includes(override)) return override as LanguageCode;
  const chosen = await getRequestLang(org.defaultLanguage);
  return org.enabledLanguages.includes(chosen) ? chosen : org.defaultLanguage;
}

export async function getStorefrontOrg(slug: string) {
  return db.restaurantOrganization.findUnique({
    where: { slug },
    include: { branding: true, settings: true, locations: { where: { isPublished: true }, orderBy: { createdAt: 'asc' }, include: { reviewSettings: true } } },
  });
}

export function allergyNoticeFor(settings: { allergyNotice: unknown } | null, lang: LanguageCode, fallback: string): string {
  const custom = (settings?.allergyNotice ?? {}) as Partial<Record<LanguageCode, string>>;
  return custom[lang]?.trim() || fallback;
}
