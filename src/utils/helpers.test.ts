/**
 * helpers.test.ts
 * Tests for helper utility functions
 */

import { addOptionalArg, addOptionalBooleanArg, addOptionalNumberArg, formatMultilineNotes, nullToUndefined } from './helpers.js';

describe('helpers', () => {
  describe('nullToUndefined', () => {
    it('should convert null values to undefined for specified fields', () => {
      const obj = {
        id: '123',
        title: 'Test',
        notes: null,
        url: null,
        dueDate: '2024-01-01',
      };

      const result = nullToUndefined(obj, ['notes', 'url']);

      expect(result.id).toBe('123');
      expect(result.title).toBe('Test');
      expect(result.notes).toBeUndefined();
      expect(result.url).toBeUndefined();
      expect(result.dueDate).toBe('2024-01-01');
    });

    it('should not modify non-null values', () => {
      const obj = {
        id: '123',
        notes: 'Some notes',
        url: 'https://example.com',
      };

      const result = nullToUndefined(obj, ['notes', 'url']);

      expect(result.notes).toBe('Some notes');
      expect(result.url).toBe('https://example.com');
    });

    it('should not modify fields not in the list', () => {
      const obj = {
        id: '123',
        notes: null,
        otherField: null,
      };

      const result = nullToUndefined(obj, ['notes']);

      expect(result.notes).toBeUndefined();
      expect(result.otherField).toBeNull();
    });

    it('should handle empty fields array', () => {
      const obj = {
        id: '123',
        notes: null,
      };

      const result = nullToUndefined(obj, []);

      expect(result.notes).toBeNull();
    });

    it('should create a new object and not mutate the original', () => {
      const obj = {
        id: '123',
        notes: null,
      };

      const result = nullToUndefined(obj, ['notes']);

      expect(result).not.toBe(obj);
      expect(obj.notes).toBeNull();
      expect(result.notes).toBeUndefined();
    });
  });

  describe('formatMultilineNotes', () => {
    it('indents continuation lines for markdown display', () => {
      const result = formatMultilineNotes('Line 1\nLine 2\nLine 3');
      expect(result).toBe('Line 1\n    Line 2\n    Line 3');
    });

    it('returns single-line string unchanged', () => {
      expect(formatMultilineNotes('No newlines here')).toBe('No newlines here');
    });

    it('handles empty string', () => {
      expect(formatMultilineNotes('')).toBe('');
    });
  });

  describe('addOptionalNumberArg', () => {
    it('adds flag and stringified number when value is defined', () => {
      const args: string[] = ['--action', 'create'];
      addOptionalNumberArg(args, '--count', 5);
      expect(args).toEqual(['--action', 'create', '--count', '5']);
    });

    it('does not add flag when value is undefined', () => {
      const args: string[] = ['--action', 'create'];
      addOptionalNumberArg(args, '--count', undefined);
      expect(args).toEqual(['--action', 'create']);
    });

    it('adds zero as a valid value', () => {
      const args: string[] = [];
      addOptionalNumberArg(args, '--offset', 0);
      expect(args).toEqual(['--offset', '0']);
    });
  });

  describe('addOptionalArg', () => {
    it('adds flag and value when defined', () => {
      const args: string[] = [];
      addOptionalArg(args, '--name', 'Test');
      expect(args).toEqual(['--name', 'Test']);
    });

    it('does not add flag for undefined value', () => {
      const args: string[] = [];
      addOptionalArg(args, '--name', undefined);
      expect(args).toEqual([]);
    });

    it('does not add flag for empty string', () => {
      const args: string[] = [];
      addOptionalArg(args, '--name', '');
      expect(args).toEqual([]);
    });
  });

  describe('addOptionalBooleanArg', () => {
    it('adds flag with "true" when value is true', () => {
      const args: string[] = [];
      addOptionalBooleanArg(args, '--isAllDay', true);
      expect(args).toEqual(['--isAllDay', 'true']);
    });

    it('adds flag with "false" when value is false', () => {
      const args: string[] = [];
      addOptionalBooleanArg(args, '--isAllDay', false);
      expect(args).toEqual(['--isAllDay', 'false']);
    });

    it('does not add flag when value is undefined', () => {
      const args: string[] = [];
      addOptionalBooleanArg(args, '--isAllDay', undefined);
      expect(args).toEqual([]);
    });
  });
});
