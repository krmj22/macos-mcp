/**
 * jxaExecutor.test.ts
 * Tests for JXA executor utility functions: sanitizeForJxa, buildScript,
 * detectPermissionError, and executeJxaWithRetry logic.
 */

import {
  buildScript,
  detectPermissionError,
  JxaError,
  sanitizeForJxa,
} from './jxaExecutor.js';

describe('sanitizeForJxa', () => {
  it('escapes backslashes', () => {
    expect(sanitizeForJxa('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes single quotes', () => {
    expect(sanitizeForJxa("O'Brien")).toBe("O\\'Brien");
  });

  it('escapes double quotes', () => {
    expect(sanitizeForJxa('He said "hello"')).toBe('He said \\"hello\\"');
  });

  it('escapes backticks', () => {
    expect(sanitizeForJxa('`code`')).toBe('\\`code\\`');
  });

  it('escapes dollar signs', () => {
    expect(sanitizeForJxa('$100')).toBe('\\$100');
  });

  it('escapes newlines', () => {
    expect(sanitizeForJxa('line1\nline2')).toBe('line1\\nline2');
  });

  it('escapes carriage returns', () => {
    expect(sanitizeForJxa('line1\rline2')).toBe('line1\\rline2');
  });

  it('escapes tabs', () => {
    expect(sanitizeForJxa('col1\tcol2')).toBe('col1\\tcol2');
  });

  it('removes null bytes', () => {
    expect(sanitizeForJxa('before\0after')).toBe('beforeafter');
  });

  it('escapes Unicode line separator U+2028', () => {
    expect(sanitizeForJxa('text\u2028more')).toBe('text\\u2028more');
  });

  it('escapes Unicode paragraph separator U+2029', () => {
    expect(sanitizeForJxa('text\u2029more')).toBe('text\\u2029more');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeForJxa('')).toBe('');
  });

  it('handles combined special characters', () => {
    const input = `He said "it's $100\\n"`;
    const result = sanitizeForJxa(input);
    expect(result).toContain('\\"');
    expect(result).toContain("\\'");
    expect(result).toContain('\\$');
    expect(result).toContain('\\\\');
  });

  it('preserves unicode text (CJK, emoji)', () => {
    expect(sanitizeForJxa('Hello 世界 🌍')).toBe('Hello 世界 🌍');
  });

  it('handles very long strings without error', () => {
    const longStr = 'a'.repeat(100_000);
    const result = sanitizeForJxa(longStr);
    expect(result.length).toBe(100_000);
  });
});

describe('buildScript', () => {
  it('replaces single placeholder', () => {
    const result = buildScript('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('replaces multiple placeholders', () => {
    const result = buildScript('{{a}} and {{b}}', { a: 'X', b: 'Y' });
    expect(result).toBe('X and Y');
  });

  it('replaces repeated placeholders', () => {
    const result = buildScript('{{x}} + {{x}}', { x: '1' });
    expect(result).toBe('1 + 1');
  });

  it('sanitizes values during replacement', () => {
    const result = buildScript('name: "{{name}}"', { name: "O'Brien" });
    expect(result).toContain("O\\'Brien");
  });

  it('leaves unmatched placeholders intact', () => {
    const result = buildScript('{{a}} {{b}}', { a: 'X' });
    expect(result).toBe('X {{b}}');
  });

  it('handles empty params', () => {
    const result = buildScript('no params here', {});
    expect(result).toBe('no params here');
  });
});

describe('detectPermissionError', () => {
  it('returns JxaError for "not allowed" pattern', () => {
    const err = detectPermissionError('Operation not allowed', 'Notes');
    expect(err).toBeInstanceOf(JxaError);
    expect(err?.isPermissionError).toBe(true);
    expect(err?.app).toBe('Notes');
  });

  it('returns JxaError for "permission" pattern', () => {
    const err = detectPermissionError(
      'User has not given permission',
      'Mail',
    );
    expect(err).toBeInstanceOf(JxaError);
    expect(err?.isPermissionError).toBe(true);
  });

  it('returns JxaError for "not authorized" pattern', () => {
    const err = detectPermissionError(
      'Application is not authorized',
      'Notes',
    );
    expect(err).not.toBeNull();
    expect(err?.isPermissionError).toBe(true);
  });

  it('returns JxaError for "AppleEvent handler failed" pattern', () => {
    const err = detectPermissionError(
      'AppleEvent handler failed',
      'Mail',
    );
    expect(err).not.toBeNull();
  });

  it('returns JxaError for Messages error code 1002', () => {
    const err = detectPermissionError('Error: 1002', 'Messages');
    expect(err).not.toBeNull();
    expect(err?.isPermissionError).toBe(true);
  });

  it('returns null for non-permission errors', () => {
    const err = detectPermissionError('Syntax error in script', 'Notes');
    expect(err).toBeNull();
  });

  it('returns null for empty stderr', () => {
    const err = detectPermissionError('', 'Notes');
    expect(err).toBeNull();
  });

  it('uses Notes patterns as fallback for unknown apps', () => {
    const err = detectPermissionError('not allowed to access', 'UnknownApp');
    expect(err).not.toBeNull();
    expect(err?.isPermissionError).toBe(true);
  });

  it('is case-insensitive for "not allowed"', () => {
    expect(detectPermissionError('NOT ALLOWED', 'Notes')).not.toBeNull();
    expect(detectPermissionError('Not Allowed', 'Notes')).not.toBeNull();
  });

  it('stores original stderr on the JxaError', () => {
    const stderr = 'Some permission denied message';
    const err = detectPermissionError(stderr, 'Notes');
    expect(err?.stderr).toBe(stderr);
  });
});

describe('JxaError', () => {
  it('stores app, isPermissionError, and stderr', () => {
    const err = new JxaError('msg', 'Notes', true, 'stderr text');
    expect(err.name).toBe('JxaError');
    expect(err.message).toBe('msg');
    expect(err.app).toBe('Notes');
    expect(err.isPermissionError).toBe(true);
    expect(err.stderr).toBe('stderr text');
  });

  it('defaults stderr to undefined', () => {
    const err = new JxaError('msg', 'Mail', false);
    expect(err.stderr).toBeUndefined();
  });
});
