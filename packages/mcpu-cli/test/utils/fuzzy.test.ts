import { describe, it, expect } from 'vitest';
import { jaroWinkler, fuzzyMatch } from '../../src/utils/fuzzy.ts';

describe('jaroWinkler', () => {
  it('returns 1 for exact matches', () => {
    expect(jaroWinkler('playwright', 'playwright')).toBe(1);
    expect(jaroWinkler('', '')).toBe(1);
  });

  it('returns 0 for empty vs non-empty', () => {
    expect(jaroWinkler('', 'playwright')).toBe(0);
    expect(jaroWinkler('playwright', '')).toBe(0);
  });

  it('returns 0 for completely different strings', () => {
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });

  it('handles typos well', () => {
    // Single character typo
    expect(jaroWinkler('playwright', 'playwrigt')).toBeGreaterThan(0.9);
    // Transposition
    expect(jaroWinkler('playwright', 'playwirhgt')).toBeGreaterThan(0.85);
  });

  it('favors prefix matches (Winkler boost)', () => {
    // Same Jaro score but different prefix
    const withPrefix = jaroWinkler('playwright', 'playwrong');
    const withoutPrefix = jaroWinkler('playwright', 'xlaywrigxt');
    expect(withPrefix).toBeGreaterThan(withoutPrefix);
  });

  it('handles short strings', () => {
    expect(jaroWinkler('ab', 'ab')).toBe(1);
    expect(jaroWinkler('a', 'b')).toBe(0);
    // Very short strings have limited match window
    expect(jaroWinkler('abc', 'acb')).toBeGreaterThan(0);
  });
});

describe('fuzzyMatch', () => {
  it('matches exact substrings (case insensitive)', () => {
    expect(fuzzyMatch('playwright', 'play')).toBe(true);
    expect(fuzzyMatch('Playwright', 'PLAY')).toBe(true);
    expect(fuzzyMatch('my-playwright-server', 'wright')).toBe(true);
  });

  it('matches with typos using Jaro-Winkler', () => {
    expect(fuzzyMatch('playwright', 'playwrigt')).toBe(true);
    expect(fuzzyMatch('chrome-devtools', 'chorme')).toBe(true);
  });

  it('does not match completely different strings', () => {
    expect(fuzzyMatch('playwright', 'database')).toBe(false);
    expect(fuzzyMatch('chrome', 'firefox')).toBe(false);
  });

  it('respects custom threshold', () => {
    // With high threshold, only close matches pass
    expect(fuzzyMatch('playwright', 'playwrigt', 0.95)).toBe(true);
    // With very high threshold, fuzzy-only matches (not substrings) fail
    // Note: 'zlaywrig' is not a substring so it uses Jaro-Winkler
    expect(fuzzyMatch('playwright', 'zlaywrig', 0.99)).toBe(false);
  });

  it('handles edge cases', () => {
    expect(fuzzyMatch('a', 'a')).toBe(true);
    expect(fuzzyMatch('', '')).toBe(true);
  });
});
