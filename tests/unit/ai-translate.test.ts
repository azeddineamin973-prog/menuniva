import { describe, expect, it } from 'vitest';
import { BATCH_ITEMS, estimateTokens, planBatches, type TranslationUnit } from '@/server/services/ai-translate';
import { parseTranslationResponse } from '@/server/translation/openrouter';
import { TranslationUnavailableError } from '@/server/translation/types';

const unit = (id: string, missing: ('en' | 'fr' | 'ar')[]): TranslationUnit => ({ kind: 'product', id, name: `Dish ${id}`, description: null, missing });

describe('parsing a model answer', () => {
  it('reads an indexed JSON answer, in any order, with or without a code fence', () => {
    expect(parseTranslationResponse('{"items":[{"i":2,"text":"Two"},{"i":1,"text":"One"}]}', 2)).toEqual(['One', 'Two']);
    expect(parseTranslationResponse('```json\n{"items":[{"i":1,"text":"One"}]}\n```', 1)).toEqual(['One']);
  });

  it('refuses an answer that is missing an item rather than shifting the rest', () => {
    // Positional output would silently attach dish 2's translation to dish 3; an index per item
    // makes the gap detectable, and the batch is retried instead.
    expect(() => parseTranslationResponse('{"items":[{"i":1,"text":"One"},{"i":3,"text":"Three"}]}', 3)).toThrow(TranslationUnavailableError);
    expect(() => parseTranslationResponse('{"items":[{"i":1,"text":"One"}]}', 2)).toThrow(/missing item 2 of 2/);
  });

  it('refuses malformed output, an out-of-range index and a non-string translation', () => {
    expect(() => parseTranslationResponse('sorry, I cannot do that', 1)).toThrow(/not valid JSON/);
    expect(() => parseTranslationResponse('{"result":["One"]}', 1)).toThrow(/no "items" list/);
    expect(() => parseTranslationResponse('{"items":[{"i":9,"text":"Nine"}]}', 1)).toThrow(TranslationUnavailableError);
    expect(() => parseTranslationResponse('{"items":[{"i":1,"text":42}]}', 1)).toThrow(TranslationUnavailableError);
  });
});

describe('batching the work', () => {
  it('never mixes target languages in one request', () => {
    const batches = planBatches([unit('a', ['en', 'fr']), unit('b', ['en'])], ['en', 'fr'], 100);
    expect(batches.map((b) => b.target)).toEqual(['en', 'fr']);
    expect(batches[0].units.map((u) => u.id)).toEqual(['a', 'b']);
    expect(batches[1].units.map((u) => u.id)).toEqual(['a']);
  });

  it('splits a long language into several requests of at most BATCH_ITEMS', () => {
    const units = Array.from({ length: BATCH_ITEMS * 2 + 3 }, (_, i) => unit(`p${i}`, ['en']));
    const batches = planBatches(units, ['en'], 1000);
    expect(batches).toHaveLength(3);
    expect(batches.map((b) => b.units.length)).toEqual([BATCH_ITEMS, BATCH_ITEMS, 3]);
  });

  it('stops at the pass limit so one request cannot run forever', () => {
    const units = Array.from({ length: 50 }, (_, i) => unit(`p${i}`, ['en', 'fr']));
    const batches = planBatches(units, ['en', 'fr'], 25);
    expect(batches.reduce((n, b) => n + b.units.length, 0)).toBe(25);
  });

  it('skips a language nothing is missing for', () => {
    expect(planBatches([unit('a', ['en'])], ['en', 'fr'], 100).map((b) => b.target)).toEqual(['en']);
  });
});

describe('cost estimate', () => {
  it('charges the instruction overhead once per request, not once per dish', () => {
    const one = estimateTokens(3000, 1);
    const many = estimateTokens(3000, 10);
    expect(many.estimatedInputTokens).toBeGreaterThan(one.estimatedInputTokens);
    // Same text in both: the only difference is the per-request overhead.
    expect(many.estimatedInputTokens - one.estimatedInputTokens).toBe(9 * 320);
  });

  it('expects output to be about the size of the input text', () => {
    const e = estimateTokens(3000, 1);
    expect(e.estimatedOutputTokens).toBeGreaterThan(1000);
    expect(e.estimatedOutputTokens).toBeLessThan(1400);
  });

  it('is zero work for an already translated menu', () => {
    expect(estimateTokens(0, 0)).toEqual({ estimatedInputTokens: 0, estimatedOutputTokens: 0 });
  });
});
