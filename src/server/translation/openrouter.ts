import 'server-only';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGES } from '@/i18n/config';
import { env } from '../env';
import { TranslationUnavailableError, type TranslationProvider } from './types';

/**
 * AI menu translation through the official OpenRouter API.
 *
 * Why an LLM rather than a phrase translator: restaurant menus are full of dish names that must
 * survive translation unchanged ("Tajine", "Pastilla", a brand of soft drink), and of short
 * fragments where a generic engine loses the food context. The instructions below state those
 * rules explicitly.
 *
 * Boundaries this file keeps:
 * - The key is read from the server environment and never leaves the server.
 * - Only the menu text that needs translating is sent. No customer data, no prices, no
 *   ingredient or allergen fields (the caller never passes them).
 * - Output is validated before it is returned: one answer per input, in the same order, non-empty
 *   and length-sane. Anything else raises TranslationUnavailableError so the caller can retry.
 * - Every answer is stored as MACHINE and stays hidden from guests until staff approve it.
 */

const API = 'https://openrouter.ai/api/v1';
const MODELS_URL = `${API}/models`;

export const LANGUAGE_NAME_EN: Record<LanguageCode, string> = {
  pt: 'European Portuguese (Portugal)',
  en: 'English',
  fr: 'French',
  ar: 'Modern Standard Arabic (Arabic script)',
  es: 'Spanish (Spain)',
};

/** Longest answer we accept for one input, so a runaway generation cannot be stored. */
function maxLengthFor(source: string) {
  return Math.max(240, source.length * 4);
}

export type TokenUsage = { promptTokens: number; completionTokens: number; requests: number };

function stripFence(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```$/, '')
    .trim();
}

/**
 * Parses the model answer. The model is asked for `{"items":[{"i":1,"text":"…"}]}` because an
 * index per item makes a dropped or reordered line detectable, which a bare array does not.
 */
export function parseTranslationResponse(content: string, expected: number): string[] {
  let body: unknown;
  try {
    body = JSON.parse(stripFence(content));
  } catch {
    throw new TranslationUnavailableError('The AI answer was not valid JSON.');
  }
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) throw new TranslationUnavailableError('The AI answer had no "items" list.');
  const out = new Array<string | undefined>(expected);
  for (const row of items) {
    if (!row || typeof row !== 'object') continue;
    const { i, text } = row as { i?: unknown; text?: unknown };
    const index = typeof i === 'number' ? i : Number(i);
    if (!Number.isInteger(index) || index < 1 || index > expected) continue;
    if (typeof text !== 'string') continue;
    out[index - 1] = text;
  }
  const missing = out.findIndex((v) => v === undefined);
  if (missing !== -1) throw new TranslationUnavailableError(`The AI answer was missing item ${missing + 1} of ${expected}.`);
  return out as string[];
}

const INSTRUCTIONS = [
  'You translate restaurant menu text for a restaurant ordering website.',
  'Rules:',
  '1. Translate the meaning naturally, as a menu would be written in the target language.',
  '2. Keep proper nouns, brand names and traditional dish names unchanged when they have no established translation (for example Tajine, Pastilla, Coca-Cola, Harira). Transliterate rather than invent a name.',
  '3. Keep every number, quantity, unit and price exactly as given. Never add or remove a number.',
  '4. Do not add ingredients, allergen claims, descriptions or marketing text that is not in the source.',
  '5. Return the translation only: no notes, no explanations, no surrounding quotation marks.',
  '6. Keep the source capitalisation style and keep the text about the same length.',
  '7. For Arabic, write in the Arabic script.',
  'Answer with JSON only, in the form {"items":[{"i":1,"text":"..."}]}, one entry for every input item, keeping the given "i" values.',
].join('\n');

export class OpenRouterProvider implements TranslationProvider {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter AI';
  readonly model: string;
  /** Token usage of every call made by this instance, for honest "what did this cost" reporting. */
  readonly usage: TokenUsage = { promptTokens: 0, completionTokens: 0, requests: 0 };

  constructor(private readonly fetchImpl: typeof fetch = fetch, model = env.OPENROUTER_MODEL) {
    this.model = model;
  }

  isConfigured() {
    return !!env.OPENROUTER_API_KEY;
  }

  private async chat(messages: { role: 'system' | 'user'; content: string }[], maxTokens: number): Promise<string> {
    if (!this.isConfigured()) throw new TranslationUnavailableError('OPENROUTER_API_KEY is missing.');
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          // Identifies the app to OpenRouter, as its documentation asks.
          'HTTP-Referer': env.APP_BASE_URL,
          'X-Title': 'MenuNiva',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          // Deterministic output: the same menu translated twice should not drift.
          temperature: 0,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new TranslationUnavailableError(e instanceof Error && e.name === 'TimeoutError' ? 'OpenRouter did not answer in time.' : 'Could not reach OpenRouter.');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // 401/402 are the two an owner can actually fix, so they are named.
      if (res.status === 401) throw new TranslationUnavailableError('OpenRouter rejected the API key (401).');
      if (res.status === 402) throw new TranslationUnavailableError('The OpenRouter account has no credit left (402).');
      if (res.status === 429) throw new TranslationUnavailableError('OpenRouter is rate limiting this key (429). Try again shortly.');
      throw new TranslationUnavailableError(`OpenRouter error ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    const body = (await res.json().catch(() => null)) as
      | { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } }
      | null;
    if (!body) throw new TranslationUnavailableError('OpenRouter returned an unreadable answer.');
    if (body.error?.message) throw new TranslationUnavailableError(`OpenRouter error: ${body.error.message.slice(0, 200)}`);
    this.usage.requests++;
    this.usage.promptTokens += body.usage?.prompt_tokens ?? 0;
    this.usage.completionTokens += body.usage?.completion_tokens ?? 0;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new TranslationUnavailableError('OpenRouter returned an empty answer.');
    return content;
  }

  /**
   * Translates many strings in one request. Empty inputs are answered with an empty string
   * without reaching the model, so a dish with no description costs nothing extra.
   */
  async translate(texts: string[], from: LanguageCode, to: LanguageCode): Promise<string[]> {
    const indexed = texts.map((text, i) => ({ i, text })).filter((t) => t.text.trim().length > 0);
    if (indexed.length === 0) return texts.map(() => '');
    const payload = { from: LANGUAGE_NAME_EN[from], to: LANGUAGE_NAME_EN[to], items: indexed.map((t, n) => ({ i: n + 1, text: t.text })) };
    const budget = Math.min(16_000, 400 + indexed.reduce((n, t) => n + t.text.length, 0) * 3);
    const content = await this.chat(
      [
        { role: 'system', content: INSTRUCTIONS },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      budget,
    );
    const answers = parseTranslationResponse(content, indexed.length);
    const out = texts.map(() => '');
    for (const [n, t] of indexed.entries()) {
      const answer = answers[n].trim();
      if (!answer) throw new TranslationUnavailableError(`The AI returned nothing for "${t.text.slice(0, 40)}".`);
      if (answer.length > maxLengthFor(t.text)) throw new TranslationUnavailableError(`The AI answer for "${t.text.slice(0, 40)}" was far longer than the original.`);
      out[t.i] = answer;
    }
    return out;
  }

  /**
   * Best-effort source-language detection from a sample of the menu. Used only to warn an owner
   * whose configured source language disagrees with what their menu is actually written in;
   * nothing is changed automatically.
   */
  async detectLanguage(sample: string[]): Promise<LanguageCode | null> {
    const text = sample
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 25)
      .join(' | ')
      .slice(0, 2000);
    if (!text) return null;
    const content = await this.chat(
      [
        { role: 'system', content: `Identify the language of the restaurant menu text. Answer with JSON only: {"language":"<one of ${LANGUAGES.join('|')}>"}. If it is none of those, answer {"language":"other"}.` },
        { role: 'user', content: text },
      ],
      40,
    );
    try {
      const code = (JSON.parse(stripFence(content)) as { language?: unknown }).language;
      return typeof code === 'string' && (LANGUAGES as readonly string[]).includes(code) ? (code as LanguageCode) : null;
    } catch {
      return null;
    }
  }
}

export type ModelPrice = { inputPerMillionUsd: number; outputPerMillionUsd: number };

let priceCache: { at: number; prices: Map<string, ModelPrice> } | null = null;

/**
 * Per-token prices from OpenRouter's public model list (no API key, not a billed call), so the
 * cost shown before translating is the real published price rather than a guess. Returns null
 * when the list cannot be read — the UI then says the cost is unknown instead of inventing one.
 */
export async function modelPrice(model: string, fetchImpl?: typeof fetch): Promise<ModelPrice | null> {
  // In the browser suite the price list is answered locally, so rendering the translations page
  // never reaches the internet (and never waits on it).
  const doFetch = fetchImpl ?? (env.APP_ENV === 'test' && env.TEST_FETCH_FIXTURES ? standInModelFetch() : fetch);
  if (!priceCache || Date.now() - priceCache.at > 60 * 60_000) {
    try {
      const res = await doFetch(MODELS_URL, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { id?: string; pricing?: { prompt?: string; completion?: string } }[] };
      const prices = new Map<string, ModelPrice>();
      for (const m of body.data ?? []) {
        const input = Number(m.pricing?.prompt);
        const output = Number(m.pricing?.completion);
        if (!m.id || !Number.isFinite(input) || !Number.isFinite(output)) continue;
        prices.set(m.id, { inputPerMillionUsd: input * 1_000_000, outputPerMillionUsd: output * 1_000_000 });
      }
      if (prices.size === 0) return null;
      priceCache = { at: Date.now(), prices };
    } catch {
      return null;
    }
  }
  return priceCache.prices.get(model) ?? null;
}

/** Test seam: clears the cached price list. */
export function resetModelPriceCache() {
  priceCache = null;
}

/**
 * Test-only stand-in for the model (browser suite). It answers the chat request from the request
 * itself — every item comes back prefixed with the target language — so the suite exercises the
 * real request building, JSON parsing, validation and storage without a billed API call and
 * without reaching the internet.
 *
 * `env.ts` refuses TEST_FETCH_FIXTURES outside APP_ENV=test, and the caller checks both, so this
 * can never be reached by a real deployment.
 */
export function standInModelFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(MODELS_URL)) {
      return jsonResponse({ data: [{ id: env.OPENROUTER_MODEL, pricing: { prompt: '0.0000001', completion: '0.0000004' } }] });
    }
    if (!url.startsWith(`${API}/chat/completions`)) return new Response('not found', { status: 404 });
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] };
    const user = body.messages?.find((msg) => msg.role === 'user')?.content ?? '{}';
    let payload: { to?: string; items?: { i: number; text: string }[] } = {};
    try {
      payload = JSON.parse(user) as typeof payload;
    } catch {
      // Language detection sends plain text, not JSON: answer with the detection shape.
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ language: 'pt' }) } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
    }
    if (!Array.isArray(payload.items)) return jsonResponse({ choices: [{ message: { content: JSON.stringify({ language: 'pt' }) } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
    const tag = (payload.to ?? '').slice(0, 2).toLowerCase() || 'xx';
    const items = payload.items.map((it) => ({ i: it.i, text: `[${tag}] ${it.text}` }));
    const chars = items.reduce((n, it) => n + it.text.length, 0);
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { prompt_tokens: Math.ceil(chars / 3), completion_tokens: Math.ceil(chars / 3) } });
  }) as typeof fetch;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
