/**
 * GitHub-style query parser for issue search.
 *
 * Supports:
 * - Plain text: "crash" → search title, description, id
 * - Multiple words: "note crash" → AND logic, both must match
 * - Quoted phrases: "\"null pointer\"" → exact phrase match
 * - Field qualifiers: "title:crash" → search specific field
 * - Negation: "-note" → exclude matches
 * - Field negation: "-label:wontfix" → exclude by field
 * - Combined: "type:bug priority:1" → multiple filters
 */

import { Status, IssueType } from '../../types/index.js';

/** Represents a single search term */
export interface Term {
  field: string;   // Empty string for general search terms
  value: string;   // The search value
  negated: boolean; // True if prefixed with -
  quoted: boolean;  // True if value was quoted
}

/** Valid field names for search qualifiers */
export const ValidFields = new Set([
  'title',
  'description',
  'desc',
  'id',
  'notes',
  'label',
  'status',
  'priority',
  'assignee',
  'type',
]);

/** Field aliases mapping */
export const FieldAliases: Record<string, string> = {
  'desc': 'description',
};

/** Normalizes a field name, applying aliases */
export function normalizeField(field: string): string {
  const lower = field.toLowerCase();
  return FieldAliases[lower] || lower;
}

/** Validates a status value */
export function validateStatus(value: string): Status | null {
  const statusValues = Object.values(Status) as string[];
  const lower = value.toLowerCase();
  // Try exact match first
  if (statusValues.includes(lower)) {
    return lower as Status;
  }
  // Try with underscores replaced by hyphens and vice versa
  const normalized = lower.replace(/-/g, '_');
  if (statusValues.includes(normalized)) {
    return normalized as Status;
  }
  return null;
}

/** Validates an issue type value */
export function validateType(value: string): IssueType | null {
  const typeValues = Object.values(IssueType) as string[];
  const lower = value.toLowerCase();
  if (typeValues.includes(lower)) {
    return lower as IssueType;
  }
  return null;
}

/** Validates a priority value (0-4) */
export function validatePriority(value: string): number | null {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0 || num > 4) {
    return null;
  }
  return num;
}

/** Parsed query with helper methods */
export class ParsedQuery {
  terms: Term[];

  constructor(terms: Term[]) {
    this.terms = terms;
  }

  /** Returns true if there are no terms */
  isEmpty(): boolean {
    return this.terms.length === 0;
  }

  /** Returns all general (non-field-specific) terms */
  generalTerms(): Term[] {
    return this.terms.filter(t => t.field === '');
  }

  /** Returns terms for a specific field */
  fieldTerms(field: string): Term[] {
    const normalized = normalizeField(field);
    return this.terms.filter(t => normalizeField(t.field) === normalized);
  }

  /** Returns the first value for a field, or undefined */
  firstFieldValue(field: string): string | undefined {
    const terms = this.fieldTerms(field);
    const nonNegated = terms.find(t => !t.negated);
    return nonNegated?.value;
  }

  /** Returns all values for a field (non-negated) */
  fieldValues(field: string): string[] {
    return this.fieldTerms(field)
      .filter(t => !t.negated)
      .map(t => t.value);
  }

  /** Returns all negated values for a field */
  negatedFieldValues(field: string): string[] {
    return this.fieldTerms(field)
      .filter(t => t.negated)
      .map(t => t.value);
  }

  /** Extracts validated status if present */
  extractStatus(): { include: Status | null; exclude: Status[] } {
    const include = this.firstFieldValue('status');
    const excludeValues = this.negatedFieldValues('status');

    return {
      include: include ? validateStatus(include) : null,
      exclude: excludeValues
        .map(v => validateStatus(v))
        .filter((s): s is Status => s !== null),
    };
  }

  /** Extracts validated type if present */
  extractType(): { include: IssueType | null; exclude: IssueType[] } {
    const include = this.firstFieldValue('type');
    const excludeValues = this.negatedFieldValues('type');

    return {
      include: include ? validateType(include) : null,
      exclude: excludeValues
        .map(v => validateType(v))
        .filter((t): t is IssueType => t !== null),
    };
  }

  /** Extracts validated priority if present */
  extractPriority(): { include: number | null; exclude: number[] } {
    const include = this.firstFieldValue('priority');
    const excludeValues = this.negatedFieldValues('priority');

    return {
      include: include ? validatePriority(include) : null,
      exclude: excludeValues
        .map(v => validatePriority(v))
        .filter((p): p is number => p !== null),
    };
  }

  /** Extracts label filters */
  extractLabels(): { include: string[]; exclude: string[] } {
    return {
      include: this.fieldValues('label'),
      exclude: this.negatedFieldValues('label'),
    };
  }

  /** Extracts assignee filter */
  extractAssignee(): { include: string | null; exclude: string[] } {
    return {
      include: this.firstFieldValue('assignee') || null,
      exclude: this.negatedFieldValues('assignee'),
    };
  }
}

/** Converts a term to a SQL LIKE pattern */
export function termToLikePattern(term: Term): string {
  // Escape SQL LIKE special characters
  const escaped = term.value
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');

  if (term.quoted) {
    // Exact phrase match - still use LIKE but with word boundaries implied
    return `%${escaped}%`;
  }
  // Substring match
  return `%${escaped}%`;
}

/**
 * Parses a query string into structured terms.
 *
 * Grammar:
 *   query      = term*
 *   term       = negation? (field_term | quoted_term | plain_term)
 *   negation   = "-"
 *   field_term = field ":" value
 *   quoted_term = '"' ... '"'
 *   plain_term = non_whitespace+
 */
export function parse(query: string): ParsedQuery {
  const terms: Term[] = [];
  let pos = 0;
  const input = query.trim();

  while (pos < input.length) {
    // Skip whitespace
    while (pos < input.length && /\s/.test(input[pos])) {
      pos++;
    }
    if (pos >= input.length) break;

    // Check for negation
    let negated = false;
    if (input[pos] === '-') {
      negated = true;
      pos++;
      if (pos >= input.length || /\s/.test(input[pos])) {
        // Standalone dash, treat as literal
        terms.push({ field: '', value: '-', negated: false, quoted: false });
        continue;
      }
    }

    // Check for quoted string
    if (input[pos] === '"') {
      pos++; // Skip opening quote
      const start = pos;
      while (pos < input.length && input[pos] !== '"') {
        pos++;
      }
      const value = input.slice(start, pos);
      if (pos < input.length) {
        pos++; // Skip closing quote
      }
      if (value.length > 0) {
        terms.push({ field: '', value, negated, quoted: true });
      }
      continue;
    }

    // Read until whitespace or end
    const start = pos;
    while (pos < input.length && !/\s/.test(input[pos])) {
      // Handle quoted value in field:value syntax
      if (input[pos] === '"') {
        break;
      }
      pos++;
    }

    let token = input.slice(start, pos);

    // Check for field:value syntax
    const colonIdx = token.indexOf(':');
    if (colonIdx > 0) {
      const field = token.slice(0, colonIdx);
      let value = token.slice(colonIdx + 1);

      // Check if value starts with quote or is empty and next char is quote
      if (value === '' && pos < input.length && input[pos] === '"') {
        // field:"quoted value" case - value is empty, quote follows
        pos++; // Skip opening quote
        const valueStart = pos;
        while (pos < input.length && input[pos] !== '"') {
          pos++;
        }
        value = input.slice(valueStart, pos);
        if (pos < input.length) {
          pos++; // Skip closing quote
        }
        terms.push({ field, value, negated, quoted: true });
      } else if (value.startsWith('"')) {
        // This shouldn't happen since we break on quote, but handle just in case
        terms.push({ field, value: value.slice(1), negated, quoted: true });
      } else if (value === '') {
        // Field with no value (e.g., "title:"), treat as literal
        terms.push({ field: '', value: token, negated, quoted: false });
      } else {
        terms.push({ field, value, negated, quoted: false });
      }
    } else {
      // Plain term
      terms.push({ field: '', value: token, negated, quoted: false });
    }
  }

  return new ParsedQuery(terms);
}
