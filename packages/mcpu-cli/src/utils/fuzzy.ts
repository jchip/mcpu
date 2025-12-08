/**
 * Jaro-Winkler string similarity algorithm
 * Returns a score between 0 (no match) and 1 (exact match)
 * Favors strings that match from the beginning (good for command names)
 */
export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;
  if (!len1 || !len2) return 0;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (matches2[j] || s1[i] !== s2[j]) continue;
      matches1[i] = matches2[j] = true;
      matches++;
      break;
    }
  }

  if (!matches) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  // Winkler adjustment: boost for common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, len1, len2); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Check if a pattern fuzzy-matches a target string
 * Uses substring match first (fast path), then Jaro-Winkler
 */
export function fuzzyMatch(target: string, pattern: string, threshold = 0.7): boolean {
  const lowerTarget = target.toLowerCase();
  const lowerPattern = pattern.toLowerCase();

  // Fast path: exact substring match
  if (lowerTarget.includes(lowerPattern)) return true;

  // Fuzzy match using Jaro-Winkler
  return jaroWinkler(lowerTarget, lowerPattern) >= threshold;
}
