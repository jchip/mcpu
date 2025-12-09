import { describe, it, expect } from 'vitest';
import {
  parse,
  ParsedQuery,
  Term,
  normalizeField,
  validateStatus,
  validateType,
  validatePriority,
  termToLikePattern,
} from './parser.js';

describe('parse', () => {
  describe('plain text', () => {
    it('parses single word', () => {
      const result = parse('crash');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0]).toEqual({
        field: '',
        value: 'crash',
        negated: false,
        quoted: false,
      });
    });

    it('parses multiple words as separate terms', () => {
      const result = parse('note crash');
      expect(result.terms).toHaveLength(2);
      expect(result.terms[0].value).toBe('note');
      expect(result.terms[1].value).toBe('crash');
    });

    it('handles extra whitespace', () => {
      const result = parse('  note   crash  ');
      expect(result.terms).toHaveLength(2);
      expect(result.terms[0].value).toBe('note');
      expect(result.terms[1].value).toBe('crash');
    });

    it('returns empty for empty string', () => {
      const result = parse('');
      expect(result.isEmpty()).toBe(true);
    });

    it('returns empty for whitespace only', () => {
      const result = parse('   ');
      expect(result.isEmpty()).toBe(true);
    });
  });

  describe('quoted phrases', () => {
    it('parses quoted phrase as single term', () => {
      const result = parse('"null pointer"');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0]).toEqual({
        field: '',
        value: 'null pointer',
        negated: false,
        quoted: true,
      });
    });

    it('parses quoted phrase with other terms', () => {
      const result = parse('crash "null pointer" error');
      expect(result.terms).toHaveLength(3);
      expect(result.terms[0].value).toBe('crash');
      expect(result.terms[1].value).toBe('null pointer');
      expect(result.terms[1].quoted).toBe(true);
      expect(result.terms[2].value).toBe('error');
    });

    it('handles unclosed quote', () => {
      const result = parse('"unclosed');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0].value).toBe('unclosed');
      expect(result.terms[0].quoted).toBe(true);
    });

    it('handles empty quotes', () => {
      const result = parse('""');
      expect(result.terms).toHaveLength(0);
    });
  });

  describe('field qualifiers', () => {
    it('parses field:value', () => {
      const result = parse('title:crash');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0]).toEqual({
        field: 'title',
        value: 'crash',
        negated: false,
        quoted: false,
      });
    });

    it('parses multiple field qualifiers', () => {
      const result = parse('type:bug priority:1');
      expect(result.terms).toHaveLength(2);
      expect(result.terms[0].field).toBe('type');
      expect(result.terms[0].value).toBe('bug');
      expect(result.terms[1].field).toBe('priority');
      expect(result.terms[1].value).toBe('1');
    });

    it('parses field with quoted value', () => {
      const result = parse('title:"null pointer exception"');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0]).toEqual({
        field: 'title',
        value: 'null pointer exception',
        negated: false,
        quoted: true,
      });
    });

    it('handles field with no value as literal', () => {
      const result = parse('title:');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0].field).toBe('');
      expect(result.terms[0].value).toBe('title:');
    });

    it('mixes field qualifiers with plain text', () => {
      const result = parse('crash type:bug urgent');
      expect(result.terms).toHaveLength(3);
      expect(result.terms[0]).toEqual({ field: '', value: 'crash', negated: false, quoted: false });
      expect(result.terms[1]).toEqual({ field: 'type', value: 'bug', negated: false, quoted: false });
      expect(result.terms[2]).toEqual({ field: '', value: 'urgent', negated: false, quoted: false });
    });
  });

  describe('negation', () => {
    it('parses negated term', () => {
      const result = parse('-note');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0]).toEqual({
        field: '',
        value: 'note',
        negated: true,
        quoted: false,
      });
    });

    it('parses negated field qualifier', () => {
      const result = parse('-label:wontfix');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0]).toEqual({
        field: 'label',
        value: 'wontfix',
        negated: true,
        quoted: false,
      });
    });

    it('parses negated quoted phrase', () => {
      const result = parse('-"not this"');
      expect(result.terms).toHaveLength(1);
      expect(result.terms[0]).toEqual({
        field: '',
        value: 'not this',
        negated: true,
        quoted: true,
      });
    });

    it('handles standalone dash as literal', () => {
      const result = parse('- test');
      expect(result.terms).toHaveLength(2);
      expect(result.terms[0]).toEqual({ field: '', value: '-', negated: false, quoted: false });
      expect(result.terms[1]).toEqual({ field: '', value: 'test', negated: false, quoted: false });
    });

    it('mixes negated and non-negated terms', () => {
      const result = parse('crash -note type:bug -status:closed');
      expect(result.terms).toHaveLength(4);
      expect(result.terms[0].negated).toBe(false);
      expect(result.terms[1].negated).toBe(true);
      expect(result.terms[2].negated).toBe(false);
      expect(result.terms[3].negated).toBe(true);
    });
  });

  describe('combined queries', () => {
    it('parses complex query', () => {
      const result = parse('type:bug priority:1 crash -label:wontfix "null pointer"');
      expect(result.terms).toHaveLength(5);

      expect(result.terms[0]).toEqual({ field: 'type', value: 'bug', negated: false, quoted: false });
      expect(result.terms[1]).toEqual({ field: 'priority', value: '1', negated: false, quoted: false });
      expect(result.terms[2]).toEqual({ field: '', value: 'crash', negated: false, quoted: false });
      expect(result.terms[3]).toEqual({ field: 'label', value: 'wontfix', negated: true, quoted: false });
      expect(result.terms[4]).toEqual({ field: '', value: 'null pointer', negated: false, quoted: true });
    });
  });
});

describe('ParsedQuery', () => {
  describe('generalTerms', () => {
    it('returns only non-field terms', () => {
      const query = parse('crash type:bug error');
      const general = query.generalTerms();
      expect(general).toHaveLength(2);
      expect(general[0].value).toBe('crash');
      expect(general[1].value).toBe('error');
    });
  });

  describe('fieldTerms', () => {
    it('returns terms for specific field', () => {
      const query = parse('type:bug type:feature title:crash');
      const typeTerms = query.fieldTerms('type');
      expect(typeTerms).toHaveLength(2);
      expect(typeTerms[0].value).toBe('bug');
      expect(typeTerms[1].value).toBe('feature');
    });

    it('normalizes field names', () => {
      const query = parse('desc:test description:other');
      const descTerms = query.fieldTerms('description');
      expect(descTerms).toHaveLength(2);
    });
  });

  describe('firstFieldValue', () => {
    it('returns first non-negated value', () => {
      const query = parse('-type:bug type:feature');
      expect(query.firstFieldValue('type')).toBe('feature');
    });

    it('returns undefined if no match', () => {
      const query = parse('crash error');
      expect(query.firstFieldValue('type')).toBeUndefined();
    });
  });

  describe('fieldValues', () => {
    it('returns all non-negated values', () => {
      const query = parse('label:urgent label:critical -label:wontfix');
      expect(query.fieldValues('label')).toEqual(['urgent', 'critical']);
    });
  });

  describe('negatedFieldValues', () => {
    it('returns all negated values', () => {
      const query = parse('label:urgent -label:wontfix -label:duplicate');
      expect(query.negatedFieldValues('label')).toEqual(['wontfix', 'duplicate']);
    });
  });

  describe('extractStatus', () => {
    it('extracts valid status', () => {
      const query = parse('status:open');
      const { include, exclude } = query.extractStatus();
      expect(include).toBe('open');
      expect(exclude).toEqual([]);
    });

    it('extracts excluded statuses', () => {
      const query = parse('-status:closed -status:wont_do');
      const { include, exclude } = query.extractStatus();
      expect(include).toBeNull();
      expect(exclude).toEqual(['closed', 'wont_do']);
    });

    it('returns null for invalid status', () => {
      const query = parse('status:invalid');
      const { include } = query.extractStatus();
      expect(include).toBeNull();
    });
  });

  describe('extractType', () => {
    it('extracts valid type', () => {
      const query = parse('type:bug');
      const { include } = query.extractType();
      expect(include).toBe('bug');
    });

    it('returns null for invalid type', () => {
      const query = parse('type:invalid');
      const { include } = query.extractType();
      expect(include).toBeNull();
    });
  });

  describe('extractPriority', () => {
    it('extracts valid priority', () => {
      const query = parse('priority:1');
      const { include } = query.extractPriority();
      expect(include).toBe(1);
    });

    it('returns null for out of range priority', () => {
      const query = parse('priority:5');
      const { include } = query.extractPriority();
      expect(include).toBeNull();
    });

    it('returns null for non-numeric priority', () => {
      const query = parse('priority:high');
      const { include } = query.extractPriority();
      expect(include).toBeNull();
    });
  });

  describe('extractLabels', () => {
    it('extracts included and excluded labels', () => {
      const query = parse('label:urgent label:bug -label:wontfix');
      const { include, exclude } = query.extractLabels();
      expect(include).toEqual(['urgent', 'bug']);
      expect(exclude).toEqual(['wontfix']);
    });
  });

  describe('extractAssignee', () => {
    it('extracts assignee', () => {
      const query = parse('assignee:alice');
      const { include, exclude } = query.extractAssignee();
      expect(include).toBe('alice');
      expect(exclude).toEqual([]);
    });

    it('extracts excluded assignees', () => {
      const query = parse('-assignee:bob');
      const { include, exclude } = query.extractAssignee();
      expect(include).toBeNull();
      expect(exclude).toEqual(['bob']);
    });
  });
});

describe('normalizeField', () => {
  it('converts to lowercase', () => {
    expect(normalizeField('Title')).toBe('title');
    expect(normalizeField('TYPE')).toBe('type');
  });

  it('applies aliases', () => {
    expect(normalizeField('desc')).toBe('description');
    expect(normalizeField('DESC')).toBe('description');
  });
});

describe('validateStatus', () => {
  it('validates known statuses', () => {
    expect(validateStatus('open')).toBe('open');
    expect(validateStatus('in_progress')).toBe('in_progress');
    expect(validateStatus('closed')).toBe('closed');
  });

  it('handles case insensitivity', () => {
    expect(validateStatus('OPEN')).toBe('open');
    expect(validateStatus('In_Progress')).toBe('in_progress');
  });

  it('returns null for invalid status', () => {
    expect(validateStatus('invalid')).toBeNull();
    expect(validateStatus('')).toBeNull();
  });
});

describe('validateType', () => {
  it('validates known types', () => {
    expect(validateType('bug')).toBe('bug');
    expect(validateType('feature')).toBe('feature');
    expect(validateType('task')).toBe('task');
    expect(validateType('epic')).toBe('epic');
  });

  it('returns null for invalid type', () => {
    expect(validateType('invalid')).toBeNull();
  });
});

describe('validatePriority', () => {
  it('validates valid priorities', () => {
    expect(validatePriority('0')).toBe(0);
    expect(validatePriority('1')).toBe(1);
    expect(validatePriority('4')).toBe(4);
  });

  it('returns null for out of range', () => {
    expect(validatePriority('-1')).toBeNull();
    expect(validatePriority('5')).toBeNull();
  });

  it('returns null for non-numeric', () => {
    expect(validatePriority('abc')).toBeNull();
    expect(validatePriority('')).toBeNull();
  });
});

describe('termToLikePattern', () => {
  it('wraps value in wildcards', () => {
    const term: Term = { field: '', value: 'crash', negated: false, quoted: false };
    expect(termToLikePattern(term)).toBe('%crash%');
  });

  it('escapes SQL LIKE special characters', () => {
    const term: Term = { field: '', value: '100%', negated: false, quoted: false };
    expect(termToLikePattern(term)).toBe('%100\\%%');
  });

  it('escapes underscore', () => {
    const term: Term = { field: '', value: 'foo_bar', negated: false, quoted: false };
    expect(termToLikePattern(term)).toBe('%foo\\_bar%');
  });

  it('handles quoted terms the same way', () => {
    const term: Term = { field: '', value: 'exact phrase', negated: false, quoted: true };
    expect(termToLikePattern(term)).toBe('%exact phrase%');
  });
});
